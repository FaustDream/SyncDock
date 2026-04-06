use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use chrono::Utc;
use rayon::prelude::*;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    git::{classify_git_failure, inspect_repository, run_git_with_cancel},
    models::{
        AppSettings, NoticeLevel, RepositoryRecord, RepositoryStatus, SyncItemState,
        SyncProgressEvent, SyncTaskItemResult, SyncTaskRecord,
    },
    storage,
};

struct ActiveTaskState {
    task_id: String,
    cancel_requested: Arc<AtomicBool>,
    shared_task: Arc<Mutex<SyncTaskRecord>>,
}

pub struct SyncRuntimeState {
    active_task: Mutex<Option<ActiveTaskState>>,
}

impl Default for SyncRuntimeState {
    fn default() -> Self {
        Self {
            active_task: Mutex::new(None),
        }
    }
}

struct ActiveTaskGuard<'a> {
    lock: &'a Mutex<Option<ActiveTaskState>>,
}

impl Drop for ActiveTaskGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.lock.lock() {
            *active = None;
        }
    }
}

pub fn cancel_sync_task(app: &AppHandle, runtime: &SyncRuntimeState) -> AppResult<Option<String>> {
    let (task_id, shared_task) = {
        let active = runtime.active_task.lock().map_err(|_| {
            AppError::new(
                "SD-TASK-003",
                NoticeLevel::Error,
                "任务状态异常",
                "任务状态异常，请查看日志并重新启动应用。",
            )
        })?;

        let Some(active_task) = active.as_ref() else {
            return Ok(None);
        };

        active_task.cancel_requested.store(true, Ordering::SeqCst);
        if let Ok(mut task) = active_task.shared_task.lock() {
            if task.running {
                task.cancel_requested = true;
                task.summary_message = build_progress_summary(&task);
            }
        }

        (active_task.task_id.clone(), Arc::clone(&active_task.shared_task))
    };

    let _ = storage::append_task_log(
        app,
        &task_id,
        &format!("[{}] 已收到取消请求，正在停止当前同步任务。", Utc::now().to_rfc3339()),
    );
    emit_progress(app, &shared_task, None, None);
    Ok(Some(task_id))
}

pub fn sync_repositories(
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
            group
                .as_ref()
                .map(|value| value.trim().is_empty() || repo.group == *value)
                .unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();

    let task_id = format!(
        "task_{}_{}",
        Utc::now().format("%Y%m%d_%H%M%S"),
        Uuid::new_v4().simple()
    );
    let paths = storage::ensure_storage(app)?;
    let started_at = Utc::now().to_rfc3339();
    let ordered_repo_ids = target_list.iter().map(|repo| repo.id.clone()).collect::<Vec<_>>();
    let cancel_requested = Arc::new(AtomicBool::new(false));
    let shared_task = Arc::new(Mutex::new(SyncTaskRecord {
        task_id: task_id.clone(),
        created_at: started_at.clone(),
        start_time: started_at.clone(),
        end_time: None,
        mode: if group.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false) {
            "group".into()
        } else if selected_ids.is_empty() {
            "all".into()
        } else {
            "selected".into()
        },
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
        summary_message: if target_list.is_empty() {
            "没有可同步的仓库。".into()
        } else {
            "同步任务已启动。".into()
        },
        log_file: paths
            .logs_dir
            .join(format!("{task_id}.log"))
            .to_string_lossy()
            .to_string(),
    }));

    {
        let mut active = runtime.active_task.lock().map_err(|_| {
            AppError::new(
                "SD-TASK-003",
                NoticeLevel::Error,
                "任务状态异常",
                "任务状态异常，请查看日志并重新启动应用。",
            )
        })?;

        if active.is_some() {
            return Err(
                AppError::new(
                    "SD-TASK-001",
                    NoticeLevel::Warning,
                    "任务重复提交",
                    "当前已有同步任务在运行，未重复启动。",
                )
                .with_action("等待当前任务完成"),
            );
        }

        *active = Some(ActiveTaskState {
            task_id: task_id.clone(),
            cancel_requested: Arc::clone(&cancel_requested),
            shared_task: Arc::clone(&shared_task),
        });
    }
    let _guard = ActiveTaskGuard {
        lock: &runtime.active_task,
    };

    let _ = storage::append_task_log(
        app,
        &task_id,
        &format!("[{}] 创建同步任务，目标仓库数：{}", Utc::now().to_rfc3339(), target_list.len()),
    );
    emit_progress(app, &shared_task, None, None);

    if target_list.is_empty() {
        let final_task = finalize_task(app, Arc::clone(&shared_task), &task_id)?;
        persist_task(app, &final_task)?;
        return Ok(final_task);
    }

    let order_map = ordered_repo_ids
        .iter()
        .enumerate()
        .map(|(index, repo_id)| (repo_id.clone(), index))
        .collect::<HashMap<_, _>>();

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
            target_list
                .par_iter()
                .map(|repo| {
                    let outcome = if cancel_for_pool.load(Ordering::SeqCst) {
                        build_cancelled_repo_outcome(
                            repo.clone(),
                            0,
                            &task_id_for_pool,
                            format!("仓库 {} 在开始前被取消。", repo.name),
                        )
                    } else {
                        execute_sync_for_repo(
                            &app_for_pool,
                            repo,
                            &settings_for_pool,
                            &task_id_for_pool,
                            cancel_for_pool.as_ref(),
                        )
                    };
                    update_task_progress(&app_for_pool, &shared_for_pool, &outcome.0, &outcome.1);
                    outcome
                })
                .collect::<Vec<_>>()
        });

    let updated_map = outcomes
        .into_iter()
        .map(|(repo, _)| (repo.id.clone(), repo))
        .collect::<HashMap<String, RepositoryRecord>>();
    for repo in repositories.iter_mut() {
        if let Some(updated) = updated_map.get(&repo.id) {
            *repo = updated.clone();
        }
    }
    storage::sort_repositories(&mut repositories);
    storage::save_repositories(app, &repositories)?;

    let mut final_task = finalize_task(app, Arc::clone(&shared_task), &task_id)?;
    final_task
        .items
        .sort_by_key(|item| order_map.get(&item.repo_id).copied().unwrap_or(usize::MAX));
    persist_task(app, &final_task)?;
    Ok(final_task)
}

fn emit_progress(
    app: &AppHandle,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    current_repo_id: Option<String>,
    current_repo_name: Option<String>,
) {
    if let Ok(task) = shared_task.lock() {
        let snapshot = task.clone();
        drop(task);
        let _ = app.emit_all(
            "sync-progress",
            SyncProgressEvent {
                task: snapshot,
                current_repo_id,
                current_repo_name,
            },
        );
    }
}

fn update_task_progress(
    app: &AppHandle,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    repo: &RepositoryRecord,
    item: &SyncTaskItemResult,
) {
    if let Ok(mut task) = shared_task.lock() {
        task.completed += 1;
        match item.state {
            SyncItemState::Success => task.success_count += 1,
            SyncItemState::Skipped => task.skipped_count += 1,
            SyncItemState::Failed => task.failed_count += 1,
            SyncItemState::Cancelled => task.cancelled_count += 1,
            _ => {}
        }
        task.items.push(item.clone());
        task.summary_message = build_progress_summary(&task);
        drop(task);
        emit_progress(
            app,
            shared_task,
            Some(repo.id.clone()),
            Some(repo.name.clone()),
        );
    }
}

fn finalize_task(
    app: &AppHandle,
    shared_task: Arc<Mutex<SyncTaskRecord>>,
    task_id: &str,
) -> AppResult<SyncTaskRecord> {
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

fn persist_task(app: &AppHandle, task: &SyncTaskRecord) -> AppResult<()> {
    let mut tasks = storage::load_tasks(app)?;
    tasks.retain(|item| item.task_id != task.task_id);
    tasks.push(task.clone());
    storage::sort_tasks(&mut tasks);
    if tasks.len() > 60 {
        tasks.truncate(60);
    }
    storage::save_tasks(app, &tasks)
}

fn execute_sync_for_repo(
    app: &AppHandle,
    repo: &RepositoryRecord,
    settings: &AppSettings,
    task_id: &str,
    cancel_requested: &AtomicBool,
) -> (RepositoryRecord, SyncTaskItemResult) {
    let started = Instant::now();
    let timeout = Duration::from_secs(settings.command_timeout_secs.clamp(10, 300));
    let mut updated = repo.clone();

    let log = |message: &str| {
        let formatted = format!(
            "[{}][{}][{}] {message}",
            Utc::now().to_rfc3339(),
            repo.id,
            repo.name
        );
        let _ = storage::append_task_log(app, task_id, &formatted);
        let _ = storage::append_repository_log(app, &repo.id, &formatted);
    };

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在开始前被取消。", repo.name),
    ) {
        log("同步任务已取消，跳过当前仓库。") ;
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log("开始同步。");

    let inspection = match inspect_repository(&repo.path, settings) {
        Ok(inspection) => inspection,
        Err(error) => {
            updated.status = RepositoryStatus {
                status_text: error.message.clone(),
                last_checked_at: Some(Utc::now().to_rfc3339()),
                ..RepositoryStatus::default()
            };
            return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
        }
    };

    updated.path = inspection.normalized_path.clone();
    updated.remote_url = inspection.remote_url.clone();
    updated.status = inspection.status.clone();

    if inspection.status.detached_head {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-REPO-006",
                NoticeLevel::Warning,
                "当前处于 detached HEAD",
                "当前仓库不在正常分支上，已跳过同步。",
            )
            .with_action("切回分支后重试"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if inspection.status.in_progress_operation {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-REPO-007",
                NoticeLevel::Warning,
                "当前处于 rebase 或 merge 中",
                "仓库正在执行 rebase 或 merge，已跳过同步。",
            )
            .with_action("请先完成或中止当前操作"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if inspection.status.has_uncommitted_changes {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-REPO-004",
                NoticeLevel::Warning,
                "存在未提交修改",
                "仓库存在未提交修改，已跳过同步以保护本地工作区。",
            )
            .with_action("提交、暂存或手动处理后重试"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if settings.skip_untracked_files && inspection.status.has_untracked_files {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-REPO-005",
                NoticeLevel::Warning,
                "存在未跟踪文件",
                "仓库存在未跟踪文件，已按当前策略跳过同步。",
            )
            .with_action("整理文件后重试，或修改同步策略"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if !inspection.status.upstream_configured {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-REPO-003",
                NoticeLevel::Warning,
                "未配置 upstream",
                "当前分支未配置 upstream，已跳过同步。",
            )
            .with_action("手动设置 upstream 后重试"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 fetch 前被取消。", repo.name),
    ) {
        log("同步任务已取消，停止当前仓库处理。") ;
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log("执行 git fetch --all --prune。");
    match run_git_with_cancel(
        Some(&inspection.normalized_path),
        &["fetch", "--all", "--prune"],
        timeout,
        Some(cancel_requested),
    ) {
        Ok(output) if output.success => {
            log(&format!("fetch 完成，耗时 {} ms。", output.duration_ms));
        }
        Ok(output) => {
            return build_repo_outcome(
                updated,
                classify_git_failure("fetch", &output.stderr, output.exit_code),
                started.elapsed().as_millis(),
                task_id,
            );
        }
        Err(error) => {
            if error.code == "SD-SYNC-006" {
                log("同步任务已取消，已终止当前 Git 命令。") ;
            }
            return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
        }
    }

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 fetch 后被取消。", repo.name),
    ) {
        log("同步任务已取消，停止后续检查。") ;
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    let post_fetch = match inspect_repository(&inspection.normalized_path, settings) {
        Ok(inspection) => inspection,
        Err(error) => return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id),
    };
    updated.status = post_fetch.status.clone();
    updated.remote_url = post_fetch.remote_url.clone();

    if post_fetch.status.ahead_count > 0 && post_fetch.status.behind_count > 0 {
        return build_repo_outcome(
            updated,
            AppError::new(
                "SD-SYNC-003",
                NoticeLevel::Error,
                "无法快进拉取",
                "当前分支同时领先且落后远端，请先手动处理分支差异。",
            )
            .with_action("打开仓库处理后再重试"),
            started.elapsed().as_millis(),
            task_id,
        );
    }

    if post_fetch.status.behind_count == 0 {
        updated.last_sync_at = Some(Utc::now().to_rfc3339());
        updated.last_sync_status = Some(SyncItemState::Success);
        updated.last_sync_message = Some("已是最新状态。".into());
        updated.last_error_message = None;
        updated.status.status_text = if post_fetch.status.ahead_count > 0 {
            format!("本地领先 {} 提交", post_fetch.status.ahead_count)
        } else {
            "状态正常".into()
        };
        log("无需拉取，仓库已是最新状态。");
        return (
            updated.clone(),
            SyncTaskItemResult {
                repo_id: updated.id.clone(),
                repo_name: updated.name.clone(),
                repo_path: updated.path.clone(),
                state: SyncItemState::Success,
                level: NoticeLevel::Info,
                code: None,
                title: "检查完成".into(),
                detail: updated
                    .last_sync_message
                    .clone()
                    .unwrap_or_else(|| "已是最新状态。".into()),
                action: None,
                technical_detail: None,
                retryable: false,
                duration_ms: started.elapsed().as_millis(),
                finished_at: Utc::now().to_rfc3339(),
            },
        );
    }

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 pull 前被取消。", repo.name),
    ) {
        log("同步任务已取消，跳过 pull。") ;
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    log("执行 git pull --ff-only。");
    match run_git_with_cancel(
        Some(&inspection.normalized_path),
        &["pull", "--ff-only"],
        timeout,
        Some(cancel_requested),
    ) {
        Ok(output) if output.success => {
            log(&format!("pull 完成，耗时 {} ms。", output.duration_ms));
        }
        Ok(output) => {
            return build_repo_outcome(
                updated,
                classify_git_failure("pull", &output.stderr, output.exit_code),
                started.elapsed().as_millis(),
                task_id,
            );
        }
        Err(error) => {
            if error.code == "SD-SYNC-006" {
                log("同步任务已取消，已终止当前 Git 命令。") ;
            }
            return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
        }
    }

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在完成前被取消。", repo.name),
    ) {
        log("同步任务已取消，停止最终状态写回。") ;
        return build_repo_outcome(updated, error, started.elapsed().as_millis(), task_id);
    }

    if let Ok(final_inspection) = inspect_repository(&inspection.normalized_path, settings) {
        updated.status = final_inspection.status;
        updated.remote_url = final_inspection.remote_url;
    }

    updated.last_sync_at = Some(Utc::now().to_rfc3339());
    updated.last_sync_status = Some(SyncItemState::Success);
    updated.last_sync_message = Some("同步完成。".into());
    updated.last_error_message = None;
    updated.status.status_text = "状态正常".into();
    log("同步完成。");

    (
        updated.clone(),
        SyncTaskItemResult {
            repo_id: updated.id.clone(),
            repo_name: updated.name.clone(),
            repo_path: updated.path.clone(),
            state: SyncItemState::Success,
            level: NoticeLevel::Info,
            code: None,
            title: "同步完成".into(),
            detail: updated
                .last_sync_message
                .clone()
                .unwrap_or_else(|| "同步完成。".into()),
            action: None,
            technical_detail: None,
            retryable: false,
            duration_ms: started.elapsed().as_millis(),
            finished_at: Utc::now().to_rfc3339(),
        },
    )
}

fn build_repo_outcome(
    mut updated: RepositoryRecord,
    error: AppError,
    duration_ms: u128,
    task_id: &str,
) -> (RepositoryRecord, SyncTaskItemResult) {
    let error = error
        .with_repo_id(updated.id.clone())
        .with_task_id(task_id.to_string());
    let cancelled = error.code == "SD-SYNC-006";
    let skipped = !cancelled && matches!(error.level, NoticeLevel::Warning);
    updated.last_sync_at = Some(Utc::now().to_rfc3339());
    updated.last_sync_status = Some(if cancelled {
        SyncItemState::Cancelled
    } else if skipped {
        SyncItemState::Skipped
    } else {
        SyncItemState::Failed
    });
    updated.last_sync_message = Some(error.message.clone());
    updated.last_error_message = if skipped || cancelled {
        None
    } else {
        Some(error.message.clone())
    };
    updated.status.status_text = error.message.clone();
    updated.status.last_checked_at = Some(Utc::now().to_rfc3339());

    (
        updated.clone(),
        SyncTaskItemResult {
            repo_id: updated.id.clone(),
            repo_name: updated.name.clone(),
            repo_path: updated.path.clone(),
            state: if cancelled {
                SyncItemState::Cancelled
            } else if skipped {
                SyncItemState::Skipped
            } else {
                SyncItemState::Failed
            },
            level: error.level.clone(),
            code: Some(error.code.clone()),
            title: error.title.clone(),
            detail: error.message.clone(),
            action: error.action.clone(),
            technical_detail: error.detail.clone(),
            retryable: error.retryable,
            duration_ms,
            finished_at: Utc::now().to_rfc3339(),
        },
    )
}

fn build_cancelled_repo_outcome(
    updated: RepositoryRecord,
    duration_ms: u128,
    task_id: &str,
    detail: String,
) -> (RepositoryRecord, SyncTaskItemResult) {
    build_repo_outcome(updated, cancelled_error(detail), duration_ms, task_id)
}

fn cancelled_error(detail: impl Into<String>) -> AppError {
    AppError::new(
        "SD-SYNC-006",
        NoticeLevel::Warning,
        "同步被取消",
        "同步任务已取消。",
    )
    .with_action("重新发起同步")
    .with_detail(detail)
}

fn check_cancel_requested(cancel_requested: &AtomicBool, detail: String) -> AppResult<()> {
    if cancel_requested.load(Ordering::SeqCst) {
        return Err(cancelled_error(detail));
    }
    Ok(())
}

fn build_progress_summary(task: &SyncTaskRecord) -> String {
    let cancelled_segment = if task.cancelled_count > 0 {
        format!("，取消 {}", task.cancelled_count)
    } else {
        String::new()
    };

    if task.cancel_requested {
        return format!(
            "正在取消任务，已完成 {}/{}，成功 {}，跳过 {}，失败 {}{}",
            task.completed,
            task.total,
            task.success_count,
            task.skipped_count,
            task.failed_count,
            cancelled_segment
        );
    }

    format!(
        "已完成 {}/{}，成功 {}，跳过 {}，失败 {}{}",
        task.completed,
        task.total,
        task.success_count,
        task.skipped_count,
        task.failed_count,
        cancelled_segment
    )
}

fn build_final_summary(task: &SyncTaskRecord) -> String {
    if task.total == 0 {
        return "没有可同步的仓库。".into();
    }

    if task.cancelled {
        return format!(
            "同步已取消：成功 {}，跳过 {}，失败 {}，取消 {}",
            task.success_count, task.skipped_count, task.failed_count, task.cancelled_count
        );
    }

    format!(
        "同步完成：成功 {}，跳过 {}，失败 {}",
        task.success_count, task.skipped_count, task.failed_count
    )
}
