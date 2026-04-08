//! Normal sync operations (safe mode)

use std::sync::{atomic::Ordering, Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::Utc;
use rayon::prelude::*;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::git::{classify_git_failure, inspect_repository, run_git_with_cancel};
use crate::models::{AppSettings, NoticeLevel, RepositoryRecord, RepositoryStatus, SyncItemState, SyncProgressEvent, SyncTaskItemResult, SyncTaskRecord};
use crate::storage;

use super::runtime::{clear_active_task, ActiveTaskState, SyncRuntimeState};
use super::outcome::{build_cancelled_repo_outcome, build_repo_outcome, check_cancel_requested};
use super::progress::{build_final_summary, build_progress_summary, emit_progress, push_progress_log};

fn format_error_log_message(error: &AppError) -> String {
    let detail = error
        .detail
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" · {}", value.trim()))
        .unwrap_or_default();
    format!("{} [{}] {}{}", error.title, error.code, error.message, detail)
}

fn append_task_error_log(app: &AppHandle, task_id: &str, error: &AppError) {
    let line = format!(
        "[{}][error] {}",
        Utc::now().to_rfc3339(),
        format_error_log_message(error)
    );
    let _ = storage::append_task_log(app, task_id, &line);
}

fn should_retry_transient(settings: &AppSettings, error: &AppError) -> bool {
    settings.auto_retry_transient_failures && error.retryable && error.code != "SD-SYNC-006"
}

fn log_repo_outcome(
    app: &AppHandle,
    task_id: &str,
    repo: &RepositoryRecord,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    updated: RepositoryRecord,
    error: AppError,
    duration_ms: u128,
) -> (RepositoryRecord, SyncTaskItemResult) {
    let level_tag = match error.level {
        NoticeLevel::Warning => "warning",
        NoticeLevel::Error | NoticeLevel::Fatal => "error",
        NoticeLevel::Info => "info",
    };
    let message = format_error_log_message(&error);
    let line = format!(
        "[{}][{}][{}][{}] {}",
        Utc::now().to_rfc3339(),
        repo.id,
        repo.name,
        level_tag,
        message
    );
    let _ = storage::append_task_log(app, task_id, &line);
    let _ = storage::append_repository_log(app, &repo.id, &line);
    push_progress_log(
        app,
        shared_task,
        level_tag,
        error.level.clone(),
        message,
        Some(repo.id.clone()),
        Some(repo.name.clone()),
    );
    build_repo_outcome(updated, error, duration_ms, task_id)
}

/// Synchronize repositories
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
    let cancel_requested = Arc::new(std::sync::atomic::AtomicBool::new(false));
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
        progress_logs: Vec::new(),
        summary_message: if target_list.is_empty() {
            "没有可同步的仓库。".into()
        } else {
            "正在后台同步仓库。".into()
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
                    "已有任务正在执行",
                    "当前已有后台任务正在执行，请等待完成后再试。",
                )
                .with_action("稍后重试"),
            );
        }

        *active = Some(ActiveTaskState {
            task_id: task_id.clone(),
            cancel_requested: Arc::clone(&cancel_requested),
            shared_task: Arc::clone(&shared_task),
        });
    }

    let _ = storage::append_task_log(
        app,
        &task_id,
        &format!("[{}] task created, target repos: {}", Utc::now().to_rfc3339(), target_list.len())
    );
    push_progress_log(
        app,
        &shared_task,
        "task-created",
        NoticeLevel::Info,
        format!("Task created with {} target repositories.", target_list.len()),
        None,
        None,
    );

    let initial_task = {
        let task = shared_task
            .lock()
            .map_err(|_| AppError::internal("task state lock unavailable"))?;
        task.clone()
    };
    persist_task(app, &initial_task)?;

    let app_for_thread = app.clone();
    let shared_for_thread = Arc::clone(&shared_task);
    let task_id_for_thread = task_id.clone();
    let active_task_lock = Arc::clone(&runtime.active_task);
    std::thread::spawn(move || {
        let run_result = run_sync_task(
            &app_for_thread,
            settings,
            repositories,
            target_list,
            ordered_repo_ids,
            &task_id_for_thread,
            Arc::clone(&shared_for_thread),
            Arc::clone(&cancel_requested),
        );

        if let Err(error) = run_result {
            append_task_error_log(&app_for_thread, &task_id_for_thread, &error);
            push_progress_log(
                &app_for_thread,
                &shared_for_thread,
                "task-error",
                NoticeLevel::Error,
                format_error_log_message(&error),
                None,
                None,
            );
            if let Ok(mut task) = shared_for_thread.lock() {
                task.running = false;
                task.end_time = Some(Utc::now().to_rfc3339());
                task.summary_message = error.message.clone();
                let _ = persist_task(&app_for_thread, &task.clone());
            }
        }
        clear_active_task(&active_task_lock);
    });

    Ok(initial_task)
}

fn run_sync_task(
    app: &AppHandle,
    settings: AppSettings,
    mut repositories: Vec<RepositoryRecord>,
    target_list: Vec<RepositoryRecord>,
    ordered_repo_ids: Vec<String>,
    task_id: &str,
    shared_task: Arc<Mutex<SyncTaskRecord>>,
    cancel_requested: Arc<std::sync::atomic::AtomicBool>,
) -> AppResult<()> {
    if target_list.is_empty() {
        let final_task = finalize_task(app, Arc::clone(&shared_task), task_id)?;
        persist_task(app, &final_task)?;
        return Ok(());
    }

    let order_map: std::collections::HashMap<String, usize> = ordered_repo_ids
        .iter()
        .enumerate()
        .map(|(index, repo_id)| (repo_id.clone(), index))
        .collect();

    let settings_for_pool = settings.clone();
    let shared_for_pool = Arc::clone(&shared_task);
    let app_for_pool = app.clone();
    let task_id_for_pool = task_id.to_string();
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
                            format!("Repository {} was cancelled before execution.", repo.name),
                        )
                    } else {
                        execute_sync_for_repo(
                            &app_for_pool,
                            repo,
                            &settings_for_pool,
                            &task_id_for_pool,
                            &shared_for_pool,
                            cancel_for_pool.as_ref(),
                        )
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
                })
                .collect::<Vec<_>>()
        });

    let updated_map = outcomes
        .into_iter()
        .map(|(repo, _)| (repo.id.clone(), repo))
        .collect::<std::collections::HashMap<String, RepositoryRecord>>();
    for repo in repositories.iter_mut() {
        if let Some(updated) = updated_map.get(&repo.id) {
            *repo = updated.clone();
        }
    }
    storage::sort_repositories(&mut repositories);
    storage::save_repositories(app, &repositories)?;

    let mut final_task = finalize_task(app, Arc::clone(&shared_task), task_id)?;
    final_task
        .items
        .sort_by_key(|item| order_map.get(&item.repo_id).copied().unwrap_or(usize::MAX));
    persist_task(app, &final_task)?;
    Ok(())
}

/// Execute sync for a single repository
fn execute_sync_for_repo(
    app: &AppHandle,
    repo: &RepositoryRecord,
    settings: &AppSettings,
    task_id: &str,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    cancel_requested: &std::sync::atomic::AtomicBool,
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
        push_progress_log(
            app,
            shared_task,
            "runtime",
            NoticeLevel::Info,
            message.to_string(),
            Some(repo.id.clone()),
            Some(repo.name.clone()),
        );
    };

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在开始前被取消。", repo.name),
    ) {
        log("同步任务已取消，跳过当前仓库。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
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
            return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
        }
    };

    updated.path = inspection.normalized_path.clone();
    updated.remote_url = inspection.remote_url.clone();
    updated.status = inspection.status.clone();

    // Skip conditions
    if inspection.status.detached_head {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-REPO-006",
                NoticeLevel::Warning,
                "当前处于 detached HEAD",
                "当前仓库不在正常分支上，已跳过同步。",
            )
            .with_action("切回分支后重试"),
            started.elapsed().as_millis(),
        );
    }

    if inspection.status.in_progress_operation {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-REPO-007",
                NoticeLevel::Warning,
                "当前处于 rebase 或 merge 中",
                "仓库正在执行 rebase 或 merge，已跳过同步。",
            )
            .with_action("请先完成或中止当前操作"),
            started.elapsed().as_millis(),
        );
    }

    if inspection.status.has_uncommitted_changes {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-REPO-004",
                NoticeLevel::Warning,
                "存在未提交修改",
                "仓库存在未提交修改，已跳过同步以保护本地工作区。",
            )
            .with_action("提交、暂存或手动处理后重试"),
            started.elapsed().as_millis(),
        );
    }

    if settings.skip_untracked_files && inspection.status.has_untracked_files {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-REPO-005",
                NoticeLevel::Warning,
                "存在未跟踪文件",
                "仓库存在未跟踪文件，已按当前策略跳过同步。",
            )
            .with_action("整理文件后重试，或修改同步策略"),
            started.elapsed().as_millis(),
        );
    }

    if !inspection.status.upstream_configured {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-REPO-003",
                NoticeLevel::Warning,
                "未配置 upstream",
                "当前分支未配置 upstream，已跳过同步。",
            )
            .with_action("手动设置 upstream 后重试"),
            started.elapsed().as_millis(),
        );
    }

    // Fetch
    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 fetch 前被取消。", repo.name),
    ) {
        log("同步任务已取消，停止当前仓库处理。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
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
            let error = classify_git_failure("fetch", &output.stderr, output.exit_code);
            if should_retry_transient(settings, &error) {
                log("fetch 遇到瞬时失败，正在自动重试一次。");
                match run_git_with_cancel(
                    Some(&inspection.normalized_path),
                    &["fetch", "--all", "--prune"],
                    timeout,
                    Some(cancel_requested),
                ) {
                    Ok(retry_output) if retry_output.success => {
                        log(&format!("fetch 重试成功，耗时 {} ms。", retry_output.duration_ms));
                    }
                    Ok(retry_output) => {
                        return log_repo_outcome(
                            app,
                            task_id,
                            repo,
                            shared_task,
                            updated,
                            classify_git_failure("fetch", &retry_output.stderr, retry_output.exit_code),
                            started.elapsed().as_millis(),
                        );
                    }
                    Err(retry_error) => {
                        return log_repo_outcome(app, task_id, repo, shared_task, updated, retry_error, started.elapsed().as_millis());
                    }
                }
            } else {
                return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
            }
        }
        Err(error) => {
            if error.code == "SD-SYNC-006" {
                log("同步任务已取消，已终止当前 Git 命令。");
            }
            if should_retry_transient(settings, &error) {
                log("fetch 遇到瞬时失败，正在自动重试一次。");
                match run_git_with_cancel(
                    Some(&inspection.normalized_path),
                    &["fetch", "--all", "--prune"],
                    timeout,
                    Some(cancel_requested),
                ) {
                    Ok(retry_output) if retry_output.success => {
                        log(&format!("fetch 重试成功，耗时 {} ms。", retry_output.duration_ms));
                    }
                    Ok(retry_output) => {
                        return log_repo_outcome(
                            app,
                            task_id,
                            repo,
                            shared_task,
                            updated,
                            classify_git_failure("fetch", &retry_output.stderr, retry_output.exit_code),
                            started.elapsed().as_millis(),
                        );
                    }
                    Err(retry_error) => {
                        return log_repo_outcome(app, task_id, repo, shared_task, updated, retry_error, started.elapsed().as_millis());
                    }
                }
            } else {
                return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
            }
        }
    }

    // Post-fetch inspection
    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 fetch 后被取消。", repo.name),
    ) {
        log("同步任务已取消，停止后续检查。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
    }

    let post_fetch = match inspect_repository(&inspection.normalized_path, settings) {
        Ok(inspection) => inspection,
        Err(error) => return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis()),
    };
    updated.status = post_fetch.status.clone();
    updated.remote_url = post_fetch.remote_url.clone();

    // Check for divergence
    if post_fetch.status.ahead_count > 0 && post_fetch.status.behind_count > 0 {
        return log_repo_outcome(
            app,
            task_id,
            repo,
            shared_task,
            updated,
            AppError::new(
                "SD-SYNC-003",
                NoticeLevel::Error,
                "无法快进拉取",
                "当前分支同时领先且落后远端，请先手动处理分支差异。",
            )
            .with_action("打开仓库处理后再重试"),
            started.elapsed().as_millis(),
        );
    }

    // Already up to date
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
                detail: updated.last_sync_message.clone().unwrap_or_else(|| "已是最新状态。".into()),
                action: None,
                technical_detail: None,
                retryable: false,
                duration_ms: started.elapsed().as_millis(),
                finished_at: Utc::now().to_rfc3339(),
            },
        );
    }

    // Pull
    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在 pull 前被取消。", repo.name),
    ) {
        log("同步任务已取消，跳过 pull。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
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
            let error = classify_git_failure("pull", &output.stderr, output.exit_code);
            if should_retry_transient(settings, &error) {
                log("pull 遇到瞬时失败，正在自动重试一次。");
                match run_git_with_cancel(
                    Some(&inspection.normalized_path),
                    &["pull", "--ff-only"],
                    timeout,
                    Some(cancel_requested),
                ) {
                    Ok(retry_output) if retry_output.success => {
                        log(&format!("pull 重试成功，耗时 {} ms。", retry_output.duration_ms));
                    }
                    Ok(retry_output) => {
                        return log_repo_outcome(
                            app,
                            task_id,
                            repo,
                            shared_task,
                            updated,
                            classify_git_failure("pull", &retry_output.stderr, retry_output.exit_code),
                            started.elapsed().as_millis(),
                        );
                    }
                    Err(retry_error) => {
                        return log_repo_outcome(app, task_id, repo, shared_task, updated, retry_error, started.elapsed().as_millis());
                    }
                }
            } else {
                return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
            }
        }
        Err(error) => {
            if error.code == "SD-SYNC-006" {
                log("同步任务已取消，已终止当前 Git 命令。");
            }
            if should_retry_transient(settings, &error) {
                log("pull 遇到瞬时失败，正在自动重试一次。");
                match run_git_with_cancel(
                    Some(&inspection.normalized_path),
                    &["pull", "--ff-only"],
                    timeout,
                    Some(cancel_requested),
                ) {
                    Ok(retry_output) if retry_output.success => {
                        log(&format!("pull 重试成功，耗时 {} ms。", retry_output.duration_ms));
                    }
                    Ok(retry_output) => {
                        return log_repo_outcome(
                            app,
                            task_id,
                            repo,
                            shared_task,
                            updated,
                            classify_git_failure("pull", &retry_output.stderr, retry_output.exit_code),
                            started.elapsed().as_millis(),
                        );
                    }
                    Err(retry_error) => {
                        return log_repo_outcome(app, task_id, repo, shared_task, updated, retry_error, started.elapsed().as_millis());
                    }
                }
            } else {
                return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
            }
        }
    }

    // Finalize
    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("仓库 {} 在完成前被取消。", repo.name),
    ) {
        log("同步任务已取消，停止最终状态写回。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
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
            detail: updated.last_sync_message.clone().unwrap_or_else(|| "同步完成。".into()),
            action: None,
            technical_detail: None,
            retryable: false,
            duration_ms: started.elapsed().as_millis(),
            finished_at: Utc::now().to_rfc3339(),
        },
    )
}

/// Finalize task and set end state
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

/// Persist task to storage
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
