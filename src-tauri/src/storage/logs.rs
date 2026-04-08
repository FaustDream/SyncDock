//! Log storage operations

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::{LogCleanupResult, LogsDiagnostics};

use super::helpers::{is_directory_writable, normalize_optional_string, save_text_file};
use super::settings::ensure_storage;

/// Append a line to task log file
pub fn append_task_log(app: &AppHandle, task_id: &str, line: &str) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    let log_path = paths.logs_dir.join(format!("{}.log", task_id));
    append_log_line(&log_path, line)
}

/// Read task log file content
pub fn read_task_log(app: &AppHandle, task_id: &str) -> AppResult<String> {
    let paths = ensure_storage(app)?;
    read_log_file(&paths.logs_dir.join(format!("{}.log", task_id)))
}

/// Export task log to a file
pub fn export_task_log(app: &AppHandle, task_id: &str, destination: &str) -> AppResult<String> {
    let target_path = super::helpers::ensure_export_file_path(destination)?;
    let content = read_task_log(app, task_id)?;
    save_text_file(&target_path, &content).map_err(map_log_export_error)?;
    Ok(target_path.to_string_lossy().to_string())
}

/// Append a line to repository log file
pub fn append_repository_log(app: &AppHandle, repo_id: &str, line: &str) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    let log_path = paths.logs_dir.join(format!("repo-{}.log", repo_id));
    append_log_line(&log_path, line)
}

/// Read repository log file content
pub fn read_repository_log(app: &AppHandle, repo_id: &str) -> AppResult<String> {
    let paths = ensure_storage(app)?;
    read_log_file(&paths.logs_dir.join(format!("repo-{}.log", repo_id)))
}

/// Read aggregated content from all repository log files
pub fn read_all_repository_logs(app: &AppHandle) -> AppResult<String> {
    let paths = ensure_storage(app)?;
    let mut log_paths = fs::read_dir(&paths.logs_dir)
        .map_err(map_log_read_error)?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|name| name.starts_with("repo-") && name.ends_with(".log"))
                    .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    log_paths.sort();

    let mut contents = Vec::new();
    for path in log_paths {
        let content = read_log_file(&path)?;
        if !content.trim().is_empty() {
            contents.push(content.trim_end().to_string());
        }
    }

    Ok(contents.join("\n"))
}

/// Export repository log to a file
pub fn export_repository_log(app: &AppHandle, repo_id: &str, destination: &str) -> AppResult<String> {
    let target_path = super::helpers::ensure_export_file_path(destination)?;
    let content = read_repository_log(app, repo_id)?;
    save_text_file(&target_path, &content).map_err(map_log_export_error)?;
    Ok(target_path.to_string_lossy().to_string())
}

/// Export aggregated repository logs to a file
pub fn export_all_repository_logs(app: &AppHandle, destination: &str) -> AppResult<String> {
    let target_path = super::helpers::ensure_export_file_path(destination)?;
    let content = read_all_repository_logs(app)?;
    save_text_file(&target_path, &content).map_err(map_log_export_error)?;
    Ok(target_path.to_string_lossy().to_string())
}

/// Get logs diagnostics information
pub fn get_logs_diagnostics(app: &AppHandle) -> AppResult<LogsDiagnostics> {
    let paths = ensure_storage(app)?;
    let settings = super::settings::load_settings(app)?;
    let configured_directory = normalize_optional_string(settings.logs_directory.as_deref());
    let using_custom_directory = configured_directory
        .as_deref()
        .map(|value| super::paths::path_equals(std::path::Path::new(value), &paths.logs_dir))
        .unwrap_or(false);

    let mut file_count = 0usize;
    let mut total_size_bytes = 0u64;
    if let Ok(entries) = fs::read_dir(&paths.logs_dir) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_file() {
                    file_count += 1;
                    total_size_bytes = total_size_bytes.saturating_add(metadata.len());
                }
            }
        }
    }

    Ok(LogsDiagnostics {
        directory: paths.logs_dir.to_string_lossy().to_string(),
        configured_directory,
        using_custom_directory,
        fallback_active: !using_custom_directory
            && settings
                .logs_directory
                .as_ref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false),
        file_count,
        total_size_bytes,
        writable: is_directory_writable(&paths.logs_dir),
    })
}

/// Cleanup old log files
pub fn cleanup_logs(app: &AppHandle) -> AppResult<LogCleanupResult> {
    let paths = ensure_storage(app)?;
    let settings = super::settings::load_settings(app)?;
    if settings.log_retention_days == 0 {
        return Ok(LogCleanupResult {
            removed_files: 0,
            freed_bytes: 0,
            directory: paths.logs_dir.to_string_lossy().to_string(),
        });
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(
            u64::from(settings.log_retention_days) * 24 * 60 * 60,
        ))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let mut removed_files = 0usize;
    let mut freed_bytes = 0u64;

    let entries = fs::read_dir(&paths.logs_dir).map_err(map_log_cleanup_error)?;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else { continue };
        if !metadata.is_file() { continue }
        let Ok(modified_at) = metadata.modified() else { continue };
        if modified_at >= cutoff { continue }
        freed_bytes = freed_bytes.saturating_add(metadata.len());
        fs::remove_file(entry.path()).map_err(map_log_cleanup_error)?;
        removed_files += 1;
    }

    Ok(LogCleanupResult {
        removed_files,
        freed_bytes,
        directory: paths.logs_dir.to_string_lossy().to_string(),
    })
}

// Internal helper functions

fn append_log_line(path: &PathBuf, line: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(map_log_write_error)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(map_log_write_error)?;
    writeln!(file, "{}", line).map_err(map_log_write_error)
}

fn read_log_file(path: &PathBuf) -> AppResult<String> {
    if !path.exists() { return Ok(String::new()); }
    fs::read_to_string(path).map_err(map_log_read_error)
}

// Error mapping functions

pub fn map_log_directory_error(error: std::io::Error) -> AppError {
    AppError::new("SD-ENV-003", crate::models::NoticeLevel::Error, "日志目录不可写", "日志目录无法创建或写入。")
        .with_detail(error.to_string())
        .with_action("检查目录权限")
}

fn map_log_write_error(error: std::io::Error) -> AppError {
    AppError::new("SD-LOG-001", crate::models::NoticeLevel::Error, "日志写入失败", "无法写入日志文件。")
        .with_detail(error.to_string())
        .with_action("检查磁盘空间和目录权限")
}

fn map_log_read_error(error: std::io::Error) -> AppError {
    AppError::new("SD-LOG-002", crate::models::NoticeLevel::Error, "日志读取失败", "无法读取日志文件。")
        .with_detail(error.to_string())
        .with_action("检查文件是否存在")
}

pub fn map_log_export_error(error: AppError) -> AppError {
    error.with_code("SD-LOG-003").with_title("日志导出失败")
}

fn map_log_cleanup_error(error: std::io::Error) -> AppError {
    AppError::new("SD-LOG-004", crate::models::NoticeLevel::Error, "日志清理失败", "清理旧日志时发生错误。")
        .with_detail(error.to_string())
        .with_action("检查目录权限")
}
