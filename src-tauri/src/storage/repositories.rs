//! Repository storage operations

use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::{NoticeLevel, RepositoryRecord};

use super::helpers::{load_json_or_default, save_json};

/// Load all repository records
pub fn load_repositories(app: &AppHandle) -> AppResult<Vec<RepositoryRecord>> {
    let paths = super::settings::ensure_storage(app)?;
    load_json_or_default::<Vec<RepositoryRecord>>(&paths.repositories_file)
}

/// Save all repository records
pub fn save_repositories(app: &AppHandle, repositories: &[RepositoryRecord]) -> AppResult<()> {
    let paths = super::settings::ensure_storage(app)?;
    save_json(&paths.repositories_file, &repositories.to_vec()).map_err(|error| {
        AppError::new("SD-CFG-002", NoticeLevel::Error, "仓库数据保存失败", "无法保存仓库列表到本地配置。")
            .with_detail(error.to_string())
            .with_action("检查目录权限")
    })
}

/// Sort repositories by priority
pub fn sort_repositories(repositories: &mut [RepositoryRecord]) {
    // Sort by priority: error > pending > warning > normal > disabled
    // Then by name alphabetically
    fn get_priority(repo: &RepositoryRecord) -> u8 {
        if !repo.enabled { return 5; }
        if !repo.status.repo_healthy { return 1; }
        if repo.status.sync_required { return 2; }
        if repo.status.has_uncommitted_changes || repo.status.has_untracked_files { return 3; }
        4
    }
    repositories.sort_by(|a, b| {
        let priority_a = get_priority(a);
        let priority_b = get_priority(b);
        match priority_a.cmp(&priority_b) {
            std::cmp::Ordering::Equal => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            other => other,
        }
    });
}
