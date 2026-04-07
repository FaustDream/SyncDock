//! Runtime state management for sync operations

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use crate::models::SyncTaskRecord;

/// Runtime state container for sync operations
pub struct SyncRuntimeState {
    pub(crate) active_task: Mutex<Option<ActiveTaskState>>,
}

impl Default for SyncRuntimeState {
    fn default() -> Self {
        Self { active_task: Mutex::new(None) }
    }
}

/// Active task state for tracking running sync
pub struct ActiveTaskState {
    pub task_id: String,
    pub cancel_requested: Arc<AtomicBool>,
    pub shared_task: Arc<Mutex<SyncTaskRecord>>,
}

/// Guard that clears active task on drop
pub struct ActiveTaskGuard<'a> {
    pub lock: &'a Mutex<Option<ActiveTaskState>>,
}

impl Drop for ActiveTaskGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.lock.lock() {
            *active = None;
        }
    }
}
