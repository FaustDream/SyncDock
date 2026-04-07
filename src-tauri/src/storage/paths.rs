//! Storage paths management

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::AppSettings;

/// Storage paths for all application data
#[derive(Debug, Clone)]
pub struct StoragePaths {
    pub root: PathBuf,
    pub logs_dir: PathBuf,
    pub crash_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub repositories_file: PathBuf,
    pub config_file: PathBuf,
    pub tasks_file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StorageDirectoryConfig {
    config_directory: Option<String>,
}

const STORAGE_DIRECTORY_FILE_NAME: &str = "storage-directory.json";

/// Get default storage root path
pub fn default_storage_root(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path_resolver().app_data_dir().ok_or_else(|| {
        AppError::new("SD-ENV-004", crate::models::NoticeLevel::Fatal, "应用目录不可写", "无法解析应用配置目录。")
    })?.join("syncdock"))
}

/// Build storage paths from root directory
pub fn build_storage_paths(root: PathBuf) -> StoragePaths {
    StoragePaths {
        logs_dir: root.join("logs"),
        crash_dir: root.join("crash"),
        backup_dir: root.join("backups"),
        repositories_file: root.join("repositories.json"),
        config_file: root.join("config.json"),
        tasks_file: root.join("tasks.json"),
        root,
    }
}

/// Resolve base storage paths (before applying custom directories)
pub fn resolve_base_paths(app: &AppHandle) -> AppResult<StoragePaths> {
    let default_root = default_storage_root(app)?;
    let configured_root = load_storage_directory_config(app)?
        .map(PathBuf::from)
        .unwrap_or_else(|| default_root.clone());
    Ok(build_storage_paths(configured_root))
}

/// Load storage directory configuration
fn load_storage_directory_config(app: &AppHandle) -> AppResult<Option<String>> {
    let path = default_storage_root(app)?.join(STORAGE_DIRECTORY_FILE_NAME);
    if !path.exists() { return Ok(None); }
    let config = super::helpers::load_json_or_default::<StorageDirectoryConfig>(&path)?;
    match super::helpers::normalize_optional_string(config.config_directory.as_deref()) {
        Some(directory) => Ok(Some(validate_config_directory(&directory)?)),
        None => Ok(None),
    }
}

/// Save storage directory configuration
pub fn save_storage_directory_config(app: &AppHandle, directory: Option<&Path>) -> AppResult<()> {
    let default_root = default_storage_root(app)?;
    fs::create_dir_all(&default_root).map_err(map_config_directory_error)?;
    let path = default_root.join(STORAGE_DIRECTORY_FILE_NAME);
    match directory {
        Some(directory) => super::helpers::save_json(&path, &StorageDirectoryConfig {
            config_directory: Some(directory.to_string_lossy().to_string())
        }).map_err(map_config_directory_change_error),
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(map_config_directory_error)?;
            }
            Ok(())
        }
    }
}

/// Prepare base storage directories and files
pub fn prepare_base_storage(paths: &StoragePaths) -> AppResult<()> {
    fs::create_dir_all(&paths.root).map_err(|error| {
        AppError::new("SD-ENV-004", crate::models::NoticeLevel::Fatal, "应用目录不可写", "应用配置目录不可写，无法保存配置和日志。")
            .with_detail(error.to_string())
            .with_action("检查目录权限")
    })?;
    fs::create_dir_all(&paths.logs_dir).map_err(super::logs::map_log_directory_error)?;
    fs::create_dir_all(&paths.crash_dir)?;
    fs::create_dir_all(&paths.backup_dir)?;
    if !paths.config_file.exists() {
        super::helpers::save_json(&paths.config_file, &AppSettings::default())?;
    }
    if !paths.repositories_file.exists() {
        super::helpers::save_json(&paths.repositories_file, &Vec::<crate::models::RepositoryRecord>::new())?;
    }
    if !paths.tasks_file.exists() {
        super::helpers::save_json(&paths.tasks_file, &Vec::<crate::models::SyncTaskRecord>::new())?;
    }
    Ok(())
}

/// Resolve effective logs directory
pub fn resolve_effective_logs_dir(configured: Option<&str>, default: &Path) -> PathBuf {
    match configured {
        Some(path) if !path.trim().is_empty() => {
            let candidate = PathBuf::from(path);
            if candidate.is_absolute() && candidate.exists() {
                candidate
            } else {
                default.to_path_buf()
            }
        }
        _ => default.to_path_buf(),
    }
}

/// Validate config directory path
pub fn validate_config_directory(path: &str) -> AppResult<String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err(AppError::new("SD-ENV-001", crate::models::NoticeLevel::Error, "路径格式错误", "配置目录必须是绝对路径。")
            .with_detail(path.to_string())
            .with_action("选择有效的绝对路径"));
    }
    Ok(candidate.to_string_lossy().to_string())
}

/// Validate logs directory path
pub fn validate_logs_directory(path: &str) -> AppResult<String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err(AppError::new("SD-ENV-001", crate::models::NoticeLevel::Error, "路径格式错误", "日志目录必须是绝对路径。")
            .with_detail(path.to_string())
            .with_action("选择有效的绝对路径"));
    }
    if !candidate.exists() {
        fs::create_dir_all(&candidate).map_err(|e| {
            AppError::new("SD-ENV-003", crate::models::NoticeLevel::Error, "日志目录不可写", "无法创建指定的日志目录。")
                .with_detail(e.to_string())
                .with_action("检查目录权限")
        })?;
    }
    Ok(candidate.to_string_lossy().to_string())
}

/// Check if two paths are equal
pub fn path_equals(left: &Path, right: &Path) -> bool {
    left.canonicalize().ok() == right.canonicalize().ok()
}

/// Migrate storage directory
pub fn migrate_storage_directory(current_paths: &StoragePaths, target_paths: &StoragePaths) -> AppResult<()> {
    copy_file_if_exists(&current_paths.config_file, &target_paths.config_file)?;
    copy_file_if_exists(&current_paths.repositories_file, &target_paths.repositories_file)?;
    copy_file_if_exists(&current_paths.tasks_file, &target_paths.tasks_file)?;
    copy_directory_if_exists(&current_paths.backup_dir, &target_paths.backup_dir)?;
    copy_directory_if_exists(&current_paths.crash_dir, &target_paths.crash_dir)?;
    if path_equals(&current_paths.logs_dir, &current_paths.root.join("logs")) {
        copy_directory_if_exists(&current_paths.logs_dir, &target_paths.logs_dir)?;
    }
    Ok(())
}

fn copy_file_if_exists(source: &Path, target: &Path) -> AppResult<()> {
    if !source.exists() { return Ok(()); }
    fs::copy(source, target).map_err(|e| AppError::internal(format!("Failed to copy {:?} to {:?}: {}", source, target, e)))?;
    Ok(())
}

fn copy_directory_if_exists(source: &Path, target: &Path) -> AppResult<()> {
    if !source.exists() { return Ok(()); }
    fs::create_dir_all(target).map_err(|e| AppError::internal(format!("Failed to create directory {:?}: {}", target, e)))?;
    for entry in fs::read_dir(source).map_err(|e| AppError::internal(format!("Failed to read directory {:?}: {}", source, e)))? {
        let entry = entry.map_err(|e| AppError::internal(e.to_string()))?;
        let target_path = target.join(entry.file_name());
        if entry.file_type().map_err(|e| AppError::internal(e.to_string()))?.is_dir() {
            copy_directory_if_exists(&entry.path(), &target_path)?;
        } else {
            copy_file_if_exists(&entry.path(), &target_path)?;
        }
    }
    Ok(())
}

// Error mapping functions
pub fn map_config_directory_error(error: std::io::Error) -> AppError {
    AppError::new("SD-ENV-002", crate::models::NoticeLevel::Error, "配置目录操作失败", "配置目录切换过程中发生错误。")
        .with_detail(error.to_string())
        .with_action("检查目录权限")
}

pub fn map_config_directory_change_error(error: AppError) -> AppError {
    error.with_code("SD-MIG-003").with_title("配置目录切换失败")
}
