//! Settings storage operations

use std::path::PathBuf;
use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::AppSettings;

use super::helpers::{load_json_or_default, normalize_optional_string, save_json};
use super::logs::map_log_directory_error;
use super::paths::{
    build_storage_paths, default_storage_root, migrate_storage_directory, path_equals,
    prepare_base_storage, resolve_base_paths, resolve_effective_logs_dir,
    save_storage_directory_config, validate_logs_directory, StoragePaths,
};

/// Load application settings
pub fn load_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let paths = resolve_storage_paths(app)?;
    Ok(normalize_settings(load_json_or_default::<AppSettings>(&paths.config_file)?))
}

/// Save application settings
pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> AppResult<()> {
    let paths = resolve_storage_paths(app)?;
    let sanitized = sanitize_settings(settings)?;
    save_json(&paths.config_file, &sanitized).map_err(map_config_write_error)
}

/// Set custom config directory
pub fn set_config_directory(app: &AppHandle, directory: Option<&str>) -> AppResult<StoragePaths> {
    let current_paths = resolve_storage_paths(app)?;
    let default_root = default_storage_root(app)?;
    let requested_root = match normalize_optional_string(directory) {
        Some(path) => PathBuf::from(super::paths::validate_config_directory(&path)?),
        None => default_root.clone(),
    };

    if !path_equals(&current_paths.root, &requested_root) {
        let target_paths = build_storage_paths(requested_root.clone());
        prepare_base_storage(&target_paths)?;
        migrate_storage_directory(&current_paths, &target_paths).map_err(super::paths::map_config_directory_change_error)?;
    }

    save_storage_directory_config(app, if path_equals(&requested_root, &default_root) { None } else { Some(requested_root.as_path()) })?;
    resolve_storage_paths(app)
}

/// Resolve storage paths with custom logs directory
pub fn resolve_storage_paths(app: &AppHandle) -> AppResult<StoragePaths> {
    use std::fs;

    let mut paths = resolve_base_paths(app)?;
    prepare_base_storage(&paths)?;
    let settings = load_json_or_default::<AppSettings>(&paths.config_file)?;
    let normalized = normalize_settings(settings);
    paths.logs_dir = resolve_effective_logs_dir(normalized.logs_directory.as_deref(), &paths.logs_dir);
    fs::create_dir_all(&paths.logs_dir).map_err(map_log_directory_error)?;
    Ok(paths)
}

/// Ensure storage is initialized
pub fn ensure_storage(app: &AppHandle) -> AppResult<StoragePaths> {
    resolve_storage_paths(app)
}

/// Normalize settings values
pub fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.concurrent_limit = settings.concurrent_limit.clamp(1, 5);
    settings.command_timeout_secs = settings.command_timeout_secs.clamp(10, 300);
    settings.log_retention_days = match settings.log_retention_days {
        0 => 0,
        days => days.clamp(1, 90),
    };
    settings.logs_directory = normalize_optional_string(settings.logs_directory.as_deref());
    settings.default_view = match settings.default_view.trim() {
        "overview" | "repositories" | "tasks" | "settings" => settings.default_view.trim().to_string(),
        _ => "overview".into(),
    };
    settings.theme_mode = match settings.theme_mode.trim() {
        "light" | "dark" | "system" => settings.theme_mode.trim().to_string(),
        _ => "system".into(),
    };
    settings.language_mode = match settings.language_mode.trim() {
        "en-US" | "zh-CN" => settings.language_mode.trim().to_string(),
        _ => "zh-CN".into(),
    };
    settings
}

/// Sanitize settings before saving
fn sanitize_settings(settings: &AppSettings) -> AppResult<AppSettings> {
    let mut sanitized = normalize_settings(settings.clone());
    if let Some(directory) = sanitized.logs_directory.clone() {
        sanitized.logs_directory = Some(validate_logs_directory(&directory)?);
    }
    Ok(sanitized)
}

// Error mapping
fn map_config_write_error(error: AppError) -> AppError {
    error.with_code("SD-CFG-001").with_title("设置保存失败")
}
