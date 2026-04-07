//! Common helper functions for storage operations

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::errors::AppError;

/// Load JSON file or return default if not exists
pub fn load_json_or_default<T: Default + for<'de> Deserialize<'de>>(path: &PathBuf) -> crate::errors::AppResult<T> {
    if !path.exists() { return Ok(T::default()); }
    let content = fs::read_to_string(path).map_err(|e| AppError::internal(format!("Failed to read {}: {}", path.display(), e)))?;
    if content.trim().is_empty() { return Ok(T::default()); }
    serde_json::from_str(&content).map_err(|e| AppError::internal(format!("Failed to parse {}: {}", path.display(), e)))
}

/// Save data to JSON file
pub fn save_json<T: Serialize>(path: &PathBuf, data: &T) -> crate::errors::AppResult<()> {
    let content = serde_json::to_string_pretty(data).map_err(|e| AppError::internal(format!("Failed to serialize JSON: {}", e)))?;
    fs::write(path, content).map_err(|e| AppError::internal(format!("Failed to write {}: {}", path.display(), e)))
}

/// Normalize optional string (trim and filter empty)
pub fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value.map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string())
}

/// Check if directory is writable
pub fn is_directory_writable(path: &Path) -> bool {
    use std::fs::OpenOptions;
    let test_file = path.join(".write_test");
    match OpenOptions::new().create(true).write(true).open(&test_file) {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

/// Ensure export file path exists and is valid
pub fn ensure_export_file_path(destination: &str) -> crate::errors::AppResult<PathBuf> {
    let path = PathBuf::from(destination.trim());
    if !path.is_absolute() {
        return Err(AppError::new("SD-ENV-001", crate::models::NoticeLevel::Error, "路径格式错误", "导出路径必须是绝对路径。")
            .with_detail(destination.to_string())
            .with_action("选择有效的导出路径"));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::internal(format!("Failed to create export directory: {}", e)))?;
    }
    Ok(path)
}

/// Save text content to file
pub fn save_text_file(path: &PathBuf, content: &str) -> crate::errors::AppResult<()> {
    use std::io::Write;
    let mut file = std::fs::File::create(path).map_err(|e| AppError::internal(format!("Failed to create file {}: {}", path.display(), e)))?;
    file.write_all(content.as_bytes()).map_err(|e| AppError::internal(format!("Failed to write file {}: {}", path.display(), e)))
}
