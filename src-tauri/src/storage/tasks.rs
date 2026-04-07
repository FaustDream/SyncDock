//! Task storage operations

use tauri::AppHandle;

use crate::errors::AppResult;
use crate::models::SyncTaskRecord;

use super::helpers::{load_json_or_default, save_json};

/// Load all task records
pub fn load_tasks(app: &AppHandle) -> AppResult<Vec<SyncTaskRecord>> {
    let paths = super::settings::ensure_storage(app)?;
    load_json_or_default::<Vec<SyncTaskRecord>>(&paths.tasks_file)
}

/// Save all task records
pub fn save_tasks(app: &AppHandle, tasks: &[SyncTaskRecord]) -> AppResult<()> {
    let paths = super::settings::ensure_storage(app)?;
    save_json(&paths.tasks_file, &tasks.to_vec()).map_err(|error| {
        crate::errors::AppError::new(
            "SD-SYNC-005",
            crate::models::NoticeLevel::Error,
            "同步结果写入失败",
            "同步已执行，但结果保存失败，请检查本地配置目录。",
        )
        .with_detail(error.to_string())
        .with_action("检查目录权限")
    })
}

/// Sort tasks by start time (newest first)
pub fn sort_tasks(tasks: &mut [SyncTaskRecord]) {
    tasks.sort_by(|left, right| right.start_time.cmp(&left.start_time));
}
