//! Background repository refresh operations

use std::sync::{atomic::Ordering, Arc, Mutex};
use std::time::Instant;

use chrono::Utc;
use rayon::prelude::*;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::git::inspect_repository;
use crate::models::{AppSettings, NoticeLevel, RepositoryRecord, RepositoryStatus, SyncItemState, SyncProgressEvent, SyncTaskItemResult, SyncTaskRecord};
use crate::storage;

use super::outcome::{build_cancelled_repo_outcome, build_repo_outcome, check_cancel_requested};
use super::progress::{emit_progress, push_progress_log};
use super::runtime::{clear_active_task, ActiveTaskState, SyncRuntimeState};

fn format_error_log_message(error: &AppError) -> String {
    let detail = error
        .detail
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" · {}", value.trim()))
        .unwrap_or_default();
    format!("{} [{}] {}{}", error.title, error.code, error.message, detail)
}

fn build_refresh_progress_summary(task: &SyncTaskRecord) -> String {
    let cancelled_segment = if task.cancelled_count > 0 {
        format!("，取消 {}", task.cancelled_count)
    } else {
        String::new()
    };

    if task.cancel_requested {
        return format!(
            "正在取消刷新任务，已完成 {}/{}，成功 {}，失败 {}{}",
            task.completed, task.total, task.success_count, task.failed_count, cancelled_segment
        );
    }

    format!(
        "已刷新 {}/{}，成功 {}，失败 {}{}",
        task.completed, task.total, task.success_count, task.failed_count, cancelled_segment
    )
}

fn build_refresh_final_summary(task: &SyncTaskRecord) -> String {
    if task.total == 0 {
        return "没有可刷新的仓库。".into();
    }
    if task.cancelled {
        return format!(
            "刷新已取消：成功 {}，失败 {}，取消 {}",
            task.success_count, task.failed_count, task.cancelled_count
        );
    }
    format!("刷新完成：成功 {}，失败 {}", task.success_count, task.failed_count)
}

fn append_task_error_log(app: &AppHandle, task_id: &str, error: &AppError) {
    let line = format!(
        "[{}][error] {}",
        Utc::now().to_rfc3339(),
        format_error_log_message(error)
    );
    let _ = storage::append_task_log(app, task_id, &line);
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

pub fn refresh_repositories(
    app: &AppHandle,
    runtime: &SyncRuntimeState,
    target_repo_ids: Option<Vec<String>>,
) -> AppResult<SyncTaskRecord> {
    let settings = storage::load_settings(app)?;
    let mut repositories = storage::load_repositories(app)?;
    storage::sort_repositories(&mut repositories);

    let selected_ids = target_repo_ids.unwrap_or_default();
    let target_list = repositories
        .iter()
        .filter(|repo| selected_ids.is_empty() || selected_ids.contains(&repo.id))
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
        mode: if selected_ids.is_empty() {
            "refresh-all".into()
        } else {
            "refresh-selected".into()
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
            "没有可刷新的仓库。".into()
        } else {
            "正在后台刷新仓库状态。".into()
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
        &format!("[{}] refresh task created, target repos: {}", Utc::now().to_rfc3339(), target_list.len())
    );
    push_progress_log(
        app,
        &shared_task,
        "task-created",
        NoticeLevel::Info,
        format!("Refresh task created with {} target repositories.", target_list.len()),
        None,
        None,
    );

    let initial_task = {
        let task = shared_task
            .lock()
            .map_err(|_| AppError::internal("task state lock unavailable"))?;
        task.clone()
    };
    persist_refresh_task(app, &initial_task)?;

    let app_for_thread = app.clone();
    let shared_for_thread = Arc::clone(&shared_task);
    let task_id_for_thread = task_id.clone();
    let active_task_lock = Arc::clone(&runtime.active_task);
    std::thread::spawn(move || {
        let run_result = run_refresh_task(
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
                let _ = persist_refresh_task(&app_for_thread, &task.clone());
            }
        }
        clear_active_task(&active_task_lock);
    });

    Ok(initial_task)
}

fn run_refresh_task(
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
        let final_task = finalize_refresh_task(app, Arc::clone(&shared_task), task_id)?;
        persist_refresh_task(app, &final_task)?;
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
                            format!("Repository {} was cancelled before refresh.", repo.name),
                        )
                    } else {
                        execute_refresh_for_repo(
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
                            task.summary_message = build_refresh_progress_summary(&task);
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

    let mut final_task = finalize_refresh_task(app, Arc::clone(&shared_task), task_id)?;
    final_task
        .items
        .sort_by_key(|item| order_map.get(&item.repo_id).copied().unwrap_or(usize::MAX));
    persist_refresh_task(app, &final_task)?;
    Ok(())
}

fn execute_refresh_for_repo(
    app: &AppHandle,
    repo: &RepositoryRecord,
    settings: &AppSettings,
    task_id: &str,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    cancel_requested: &std::sync::atomic::AtomicBool,
) -> (RepositoryRecord, SyncTaskItemResult) {
    let started = Instant::now();
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
            "refresh",
            NoticeLevel::Info,
            message.to_string(),
            Some(repo.id.clone()),
            Some(repo.name.clone()),
        );
    };

    if let Err(error) = check_cancel_requested(
        cancel_requested,
        format!("Repository {} was cancelled before refresh started.", repo.name),
    ) {
        log("刷新任务已取消，跳过当前仓库。");
        return log_repo_outcome(app, task_id, repo, shared_task, updated, error, started.elapsed().as_millis());
    }

    log("开始刷新仓库状态。");

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
    updated.last_error_message = None;
    log("仓库状态刷新完成。");

    (
        updated.clone(),
        SyncTaskItemResult {
            repo_id: updated.id.clone(),
            repo_name: updated.name.clone(),
            repo_path: updated.path.clone(),
            state: SyncItemState::Success,
            level: NoticeLevel::Info,
            code: None,
            title: "刷新完成".into(),
            detail: updated.status.status_text.clone(),
            action: None,
            technical_detail: None,
            retryable: false,
            duration_ms: started.elapsed().as_millis(),
            finished_at: Utc::now().to_rfc3339(),
        },
    )
}

fn finalize_refresh_task(
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
        task.summary_message = build_refresh_final_summary(&task);
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

fn persist_refresh_task(app: &AppHandle, task: &SyncTaskRecord) -> AppResult<()> {
    let mut tasks = storage::load_tasks(app)?;
    tasks.retain(|item| item.task_id != task.task_id);
    tasks.push(task.clone());
    storage::sort_tasks(&mut tasks);
    if tasks.len() > 60 {
        tasks.truncate(60);
    }
    storage::save_tasks(app, &tasks)
}
