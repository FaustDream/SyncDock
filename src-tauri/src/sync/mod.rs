//! Sync module - handles repository synchronization operations
//!
//! This module is organized into the following submodules:
//! - `runtime`: Runtime state management for sync operations
//! - `progress`: Progress tracking and event emission
//! - `outcome`: Outcome building utilities
//! - `sync`: Normal sync operations (safe mode)
//! - `force_sync`: Force sync operations (reset --hard mode)

mod runtime;
mod progress;
mod outcome;
mod sync;
mod force_sync;
mod refresh;

pub use runtime::SyncRuntimeState;
pub use sync::sync_repositories;
pub use force_sync::force_sync_repositories;
pub use refresh::refresh_repositories;

use std::sync::Arc;
use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::NoticeLevel;
use crate::storage;

/// Cancel the currently running background task
pub fn cancel_sync_task(app: &AppHandle, runtime: &SyncRuntimeState) -> AppResult<Option<String>> {
    let (task_id, shared_task) = {
        let active = runtime.active_task.lock().map_err(|_| {
            AppError::new("SD-TASK-003", NoticeLevel::Error, "任务状态异常", "任务状态异常，请查看日志并重新启动应用。")
        })?;

        let Some(active_task) = active.as_ref() else { return Ok(None); };

        active_task.cancel_requested.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(mut task) = active_task.shared_task.lock() {
            if task.running {
                task.cancel_requested = true;
                task.summary_message = progress::build_progress_summary(&task);
            }
        }

        (active_task.task_id.clone(), Arc::clone(&active_task.shared_task))
    };

    let _ = storage::append_task_log(app, &task_id, &format!("[{}] 已收到取消请求，正在停止当前同步任务。", chrono::Utc::now().to_rfc3339()));
    progress::emit_progress(app, &shared_task, None, None);
    Ok(Some(task_id))
}
