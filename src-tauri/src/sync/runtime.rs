//! Runtime state management for sync operations

use std::sync::{atomic::AtomicBool, Arc, Mutex};

use crate::models::SyncTaskRecord;

/// Runtime state container for sync operations
pub struct SyncRuntimeState {
    pub(crate) active_task: Arc<Mutex<Option<ActiveTaskState>>>,
}

impl Default for SyncRuntimeState {
    fn default() -> Self {
        Self { active_task: Arc::new(Mutex::new(None)) }
    }
}

/// Active task state for tracking running sync
pub struct ActiveTaskState {
    pub task_id: String,
    pub cancel_requested: Arc<AtomicBool>,
    pub shared_task: Arc<Mutex<SyncTaskRecord>>,
}

pub fn clear_active_task(lock: &Arc<Mutex<Option<ActiveTaskState>>>) {
    if let Ok(mut active) = lock.lock() {
        *active = None;
    }
}
