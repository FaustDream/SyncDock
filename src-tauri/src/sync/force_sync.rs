//! Force sync operations (reset --hard mode)

use std::sync::{atomic::Ordering, Arc};
use std::time::{Duration, Instant};

use chrono::Utc;
use rayon::prelude::*;
use tauri::AppHandle;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::git::{classify_git_failure, inspect_repository, run_git_with_cancel};
use crate::models::{AppSettings, NoticeLevel, RepositoryRecord, RepositoryStatus, SyncItemState, SyncTaskRecord};
use crate::storage;

use super::runtime::{ActiveTaskGuard, ActiveTaskState, SyncRuntimeState};
use super::outcome::{build_cancelled_repo_outcome, build_repo_outcome, check_cancel_requested};
use super::progress::{build_final_summary, build_progress_summary, emit_progress};

/// Force synchronize repositories (ignoring local changes, using reset --hard)
pub fn force_sync_repositories(
    app: &AppHandle,
    runtime: &SyncRuntimeState,
    target_repo_ids: Option<Vec<String>>,
    group: Option<String>,
) -> AppResult<SyncTaskRecord> {
    let settings = storage::load_settings(app)?;
    let mut repositories = storage::load_repositories(app)?;
    storage::sort_repositories(&mut repositories);

    let selected_ids = target_repo_ids.unwrap_or_default();
    let target_list = repositories
        .iter()
        .filter(|repo| repo.enabled)
        .filter(|repo| selected_ids.is_empty() || selected_ids.contains(&repo.id))
        .filter(|repo| {
            group.as_ref().map(|value| value.trim().is_empty() || repo.group == *value).unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();

    let task_id = format!("task_{}_{}", Utc::now().format("%Y%m%d_%H%M%S"), Uuid::new_v4().simple());
    let paths = storage::ensure_storage(app)?;
    let started_at = Utc::now().to_rfc3339();
    let ordered_repo_ids = target_list.iter().map(|repo| repo.id.clone()).collect::<Vec<_>>();
    let cancel_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let mode = if group.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
        "force-group"
    } else if selected_ids.is_empty() {
        "force-all"
    } else {
        "force-selected"
    };
    let shared_task = Arc::new(std::sync::Mutex::new(SyncTaskRecord {
        task_id: task_id.clone(),
        created_at: started_at.clone(),
        start_time: started_at.clone(),
        end_time: None,
        mode: mode.into(),
        running: true,
        cancel_requested: false,
        cancelled: false,
        total: target_list.len(),
        completed: 0,
        success_count: 0,
        failed_count: 0,
        skipped_count: 0,
        cancelled_count: 0,
        target_repo_ids: ordered_repo_ids.clone(),
        items: Vec::new(),
        summary_message: if target_list.is_empty() { "没有可同步的仓库。" } else { "强制同步任务已启动。" }.into(),
        log_file: paths.logs_dir.join(format!("{task_id}.log")).to_string_lossy().to_string(),
    }));

    {
        let mut active = runtime.active_task.lock().map_err(|_| {
            AppError::new("SD-TASK-003", NoticeLevel::Error, "任务状态异常", "任务状态异常，请查看日志并重新启动应用。")
        })?;

        if active.is_some() {
            return Err(AppError::new("SD-TASK-001", NoticeLevel::Warning, "任务重复提交", "当前已有同步任务在运行，未重复启动。").with_action("等待当前任务完成"));
        }

        *active = Some(ActiveTaskState {
            task_id: task_id.clone(),
            cancel_requested: Arc::clone(&cancel_requested),
            shared_task: Arc::clone(&shared_task),
        });
    }
    let _guard = ActiveTaskGuard { lock: &runtime.active_task };

    let _ = storage::append_task_log(app, &task_id, &format!("[{}] 创建强制同步任务，目标仓库数：{}", Utc::now().to_rfc3339(), target_list.len()));
    emit_progress(app, &shared_task, None, None);

    if target_list.is_empty() {
        let final_task = finalize_force_task(app, Arc::clone(&shared_task), &task_id)?;
        persist_force_task(app, &final_task)?;
        return Ok(final_task);
    }

    let order_map: std::collections::HashMap<String, usize> = ordered_repo_ids.iter().enumerate().map(|(index, repo_id)| (repo_id.clone(), index)).collect();
    let settings_for_pool = settings.clone();
    let shared_for_pool = Arc::clone(&shared_task);
    let app_for_pool = app.clone();
    let task_id_for_pool = task_id.clone();
    let cancel_for_pool = Arc::clone(&cancel_requested);

    let outcomes = rayon::ThreadPoolBuilder::new()
        .num_threads(settings.concurrent_limit.clamp(1, 5))
        .build()
        .map_err(|error| AppError::internal(error.to_string()))?
        .install(|| {
            target_list.par_iter().map(|repo| {
                let outcome = if cancel_for_pool.load(Ordering::SeqCst) {
                    build_cancelled_repo_outcome(repo.clone(), 0, &task_id_for_pool, format!("仓库 {} 在开始前被取消。", repo.name))
                } else {
                    execute_force_sync_for_repo(&app_for_pool, repo, &settings_for_pool, &task_id_for_pool, cancel_for_pool.as_ref())
                };
                {
                    if let Ok(mut task) = shared_for_pool.lock() {
                        task.completed += 1;
                        match outcome.1.state {
                            SyncItemState::Success => task.success_count += 1,
                            SyncItemState::Skipped => task.skipped_count += 1,
                            SyncItemState::Failed => task.failed_count += 1,
                            SyncItemState::Cancelled => task.cancelled_count += 1,
                            _ => {}
                        }
                        task.items.push(outcome.1.clone());
                        task.summary_message = build_progress_summary(&task);
                    }
                    emit_progress(&app_for_pool, &shared_for_pool, Some(outcome.0.id.clone()), Some(outcome.0.name.clone()));
                }
                outcome
            }).collect::<Vec<_>>()
        });

    let updated_map = outcomes.into_iter().map(|(repo, _)| (repo.id.clone(), repo)).collect::<std::collections::HashMap<String, RepositoryRecord>>();
    for repo in repositories.iter_mut() {
        if let Some(updated) = updated_map.get(&repo.id) { *repo = updated.clone(); }
    }
    storage::sort_repositories(&mut repositories);
    storage::save_repositories(app, &repositories)?;

    let mut final_task = finalize_force_task(app, Arc::clone(&shared_task), &task_id)?;
    final_task.items.sort_by_key(|item| order_map.get(&item.repo_id).copied().unwrap_or(usize::MAX));
    persist_force_task(app, &final_task)?;
    Ok(final_task)
}

/// Execute force sync for a single repository (using git reset --hard)
fn execute_force_sync_for_repo(
    app: &AppHandle,
    repo: &RepositoryRecord,
    settings: &AppSettings,
    task_id: &str,
    cancel_requested: &std::sync::atomic::AtomicBool,
) -> (RepositoryRecord, crate::models::SyncTaskItemResult) {
    use crate::models::SyncTaskItemResult;

    let started = Instant::now();
    let timeout = Duration::from_secs(settings.command_timeout_secs.clamp(10, 300));
    let mut updated = repo.clone();

    let log = |message: &str| {
        let formatted = format!("[{}][{}][{}] {message}", Utc::now().to_rfc3339(), repo.id, repo.name);
        let _ = storage::append_task_log(app, task_id, &formatted);
        let _ = storage::append_repository_log(app, &repo.id, &formatted);
    };

    if let Err(error) = check_cancel_requested(cancel_requested, format!("仓库 {} 在开始前被取消。", repo.name)) {
        log("强制同步任务已取消，跳过当前仓库。");
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log("开始强制同步。");

    let inspection = match inspect_repository(&repo.path, settings) {
        Ok(inspection) => inspection,
        Err(error) => {
            updated.status = RepositoryStatus { status_text: error.message.clone(), last_checked_at: Some(Utc::now().to_rfc3339()), ..RepositoryStatus::default() };
            return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
        }
    };

    updated.path = inspection.normalized_path.clone();
    updated.remote_url = inspection.remote_url.clone();
    updated.status = inspection.status.clone();

    // In force mode, only skip if detached head or no upstream
    if inspection.status.detached_head {
        return build_repo_outcome(updated, AppError::new("SD-REPO-006", NoticeLevel::Warning, "当前处于 detached HEAD", "当前仓库不在正常分支上，已跳过同步。").with_action("切回分支后重试"), started.elapsed().as_millis(), task_id);
    }

    if !inspection.status.upstream_configured {
        return build_repo_outcome(updated, AppError::new("SD-REPO-003", NoticeLevel::Warning, "未配置 upstream", "当前分支未配置 upstream，已跳过同步。").with_action("手动设置 upstream 后重试"), started.elapsed().as_millis(), task_id);
    }

    // Fetch
    if let Err(error) = check_cancel_requested(cancel_requested, format!("仓库 {} 在 fetch 前被取消。", repo.name)) {
        log("强制同步任务已取消，停止当前仓库处理。");
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log("执行 git fetch --all --prune。");
    match run_git_with_cancel(Some(&inspection.normalized_path), &["fetch", "--all", "--prune"], timeout, Some(cancel_requested)) {
        Ok(output) if output.success => { log(&format!("fetch 完成，耗时 {} ms。", output.duration_ms)); }
        Ok(output) => { return build_repo_outcome(updated, classify_git_failure("fetch", &output.stderr, output.exit_code), started.elapsed().as_millis(), task_id); }
        Err(error) => { if error.code == "SD-SYNC-006" { log("强制同步任务已取消，已终止当前 Git 命令。"); } return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id); }
    }

    // Get current branch
    let branch = inspection.status.current_branch.clone();

    // Reset --hard to upstream
    if let Err(error) = check_cancel_requested(cancel_requested, format!("仓库 {} 在 reset 前被取消。", repo.name)) {
        log("强制同步任务已取消，跳过 reset。");
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log(&format!("执行 git reset --hard origin/{}。", branch));
    let reset_args = format!("origin/{}", branch);
    match run_git_with_cancel(Some(&inspection.normalized_path), &["reset", "--hard", &reset_args], timeout, Some(cancel_requested)) {
        Ok(output) if output.success => { log(&format!("reset 完成，耗时 {} ms。", output.duration_ms)); }
        Ok(output) => { return build_repo_outcome(updated, classify_git_failure("reset", &output.stderr, output.exit_code), started.elapsed().as_millis(), task_id); }
        Err(error) => { if error.code == "SD-SYNC-006" { log("强制同步任务已取消，已终止当前 Git 命令。"); } return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id); }
    }

    // Finalize
    if let Ok(final_inspection) = inspect_repository(&inspection.normalized_path, settings) {
        updated.status = final_inspection.status;
        updated.remote_url = final_inspection.remote_url;
    }

    updated.last_sync_at = Some(Utc::now().to_rfc3339());
    updated.last_sync_status = Some(SyncItemState::Success);
    updated.last_sync_message = Some("强制同步完成。".into());
    updated.last_error_message = None;
    updated.status.status_text = "状态正常".into();
    log("强制同步完成。");

    (
        updated.clone(),
        SyncTaskItemResult {
            repo_id: updated.id.clone(),
            repo_name: updated.name.clone(),
            repo_path: updated.path.clone(),
            state: SyncItemState::Success,
            level: NoticeLevel::Info,
            code: None,
            title: "强制同步完成".into(),
            detail: "强制同步完成，本地更改已被覆盖。".into(),
            action: None,
            technical_detail: None,
            retryable: false,
            duration_ms: started.elapsed().as_millis(),
            finished_at: Utc::now().to_rfc3339(),
        },
    )
}

/// Finalize force sync task
fn finalize_force_task(
    app: &AppHandle,
    shared_task: Arc<std::sync::Mutex<SyncTaskRecord>>,
    task_id: &str,
) -> AppResult<SyncTaskRecord> {
    use tauri::Manager;
    use crate::models::SyncProgressEvent;

    let task = {
        let mut task = shared_task
            .lock()
            .map_err(|_| AppError::internal("任务状态锁不可用"))?;
        task.running = false;
        task.end_time = Some(Utc::now().to_rfc3339());
        task.cancelled = task.cancelled_count > 0;
        task.cancel_requested = false;
        task.summary_message = build_final_summary(&task);
        task.clone()
    };

    let _ = storage::append_task_log(
        app,
        task_id,
        &format!("[{}] {}", Utc::now().to_rfc3339(), task.summary_message),
    );
    let _ = app.emit_all(
        "sync-progress",
        SyncProgressEvent {
            task: task.clone(),
            current_repo_id: None,
            current_repo_name: None,
        },
    );
    Ok(task)
}

/// Persist force sync task to storage
fn persist_force_task(app: &AppHandle, task: &SyncTaskRecord) -> AppResult<()> {
    let mut tasks = storage::load_tasks(app)?;
    tasks.retain(|item| item.task_id != task.task_id);
    tasks.push(task.clone());
    storage::sort_tasks(&mut tasks);
    if tasks.len() > 60 {
        tasks.truncate(60);
    }
    storage::save_tasks(app, &tasks)
}
