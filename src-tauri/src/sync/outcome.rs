//! Outcome building utilities for sync operations

use chrono::Utc;

use crate::errors::AppError;
use crate::models::{NoticeLevel, RepositoryRecord, SyncItemState, SyncTaskItemResult};

/// Build a repository sync outcome from an error
pub fn build_repo_outcome(
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

/// Build a cancelled repository outcome
pub fn build_cancelled_repo_outcome(
    updated: RepositoryRecord,
    duration_ms: u128,
    task_id: &str,
    detail: String,
) -> (RepositoryRecord, SyncTaskItemResult) {
    build_repo_outcome(updated, cancelled_error(detail), duration_ms, task_id)
}

/// Create a cancelled error
pub fn cancelled_error(detail: impl Into<String>) -> AppError {
    AppError::new(
        "SD-SYNC-006",
        NoticeLevel::Warning,
        "同步被取消",
        "同步任务已取消。",
    )
    .with_action("重新发起同步")
    .with_detail(detail)
}

/// Check if cancel was requested
pub fn check_cancel_requested(cancel_requested: &std::sync::atomic::AtomicBool, detail: String) -> crate::errors::AppResult<()> {
    if cancel_requested.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(cancelled_error(detail));
    }
    Ok(())
}
