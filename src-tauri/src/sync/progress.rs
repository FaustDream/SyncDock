//! Progress tracking and event emission for sync operations

use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::models::{SyncProgressEvent, SyncTaskProgressLog, SyncTaskRecord, SyncItemState, NoticeLevel};

/// Emit sync progress event to frontend
pub fn emit_progress(
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

pub fn push_progress_log(
    app: &AppHandle,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    phase: &str,
    level: NoticeLevel,
    message: String,
    repo_id: Option<String>,
    repo_name: Option<String>,
) {
    if let Ok(mut task) = shared_task.lock() {
        task.progress_logs.push(SyncTaskProgressLog {
            at: chrono::Utc::now().to_rfc3339(),
            level,
            phase: phase.to_string(),
            message,
            repo_id: repo_id.clone(),
            repo_name: repo_name.clone(),
        });
        if task.progress_logs.len() > 200 {
            let overflow = task.progress_logs.len() - 200;
            task.progress_logs.drain(0..overflow);
        }
    }
    emit_progress(app, shared_task, repo_id, repo_name);
}

/// Update task progress after a repository sync completes
#[allow(dead_code)]
pub fn update_task_progress(
    app: &AppHandle,
    shared_task: &Arc<Mutex<SyncTaskRecord>>,
    repo_id: &str,
    repo_name: &str,
    item_state: SyncItemState,
    _item_level: NoticeLevel,
) {
    if let Ok(mut task) = shared_task.lock() {
        task.completed += 1;
        match item_state {
            SyncItemState::Success => task.success_count += 1,
            SyncItemState::Skipped => task.skipped_count += 1,
            SyncItemState::Failed => task.failed_count += 1,
            SyncItemState::Cancelled => task.cancelled_count += 1,
            _ => {}
        }
        task.summary_message = build_progress_summary(&task);
        drop(task);
        emit_progress(app, shared_task, Some(repo_id.to_string()), Some(repo_name.to_string()));
    }
}

/// Build progress summary message
pub fn build_progress_summary(task: &SyncTaskRecord) -> String {
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

/// Build final summary message
pub fn build_final_summary(task: &SyncTaskRecord) -> String {
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
