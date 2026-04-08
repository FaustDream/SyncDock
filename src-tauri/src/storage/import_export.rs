//! Configuration import and export operations

use std::fs;
use std::path::Path;

use chrono::Utc;
use tauri::AppHandle;

use crate::errors::{AppError, AppResult};
use crate::models::{
    AppSettings, ConfigExportResult, ConfigImportPreview, ConfigImportRequest,
    ConfigImportResult, ConfigTransferBundle, ImportRepoConflict, ImportStrategy,
    InlineNotice, NoticeLevel, PathPrefixReplacement, RepositoryRecord, SyncTaskRecord,
};

use super::helpers::{load_json_or_default, normalize_optional_string, save_json};
use super::paths::validate_logs_directory;

/// Export configuration to a file
pub fn export_config(app: &AppHandle, destination: &str) -> AppResult<ConfigExportResult> {
    let target_path = super::helpers::ensure_export_file_path(destination)?;
    let mut repositories = super::repositories::load_repositories(app)?;
    let mut tasks = super::tasks::load_tasks(app)?;
    super::repositories::sort_repositories(&mut repositories);
    super::tasks::sort_tasks(&mut tasks);

    let bundle = ConfigTransferBundle {
        version: 2,
        exported_at: Utc::now().to_rfc3339(),
        settings: super::settings::load_settings(app)?,
        repositories: repositories.clone(),
        tasks: tasks.clone(),
    };
    save_json(&target_path, &bundle).map_err(map_migration_export_error)?;
    Ok(ConfigExportResult {
        path: target_path.to_string_lossy().to_string(),
        repository_count: repositories.len(),
        task_count: tasks.len(),
    })
}

/// Preview configuration import
pub fn preview_config_import(app: &AppHandle, source: &str) -> AppResult<ConfigImportPreview> {
    let bundle = load_import_bundle(source)?;
    let current_settings = super::settings::load_settings(app)?;
    let current_repositories = super::repositories::load_repositories(app)?;
    let repo_conflicts = collect_repo_conflicts(&current_repositories, &bundle.repositories);
    let invalid_repo_paths = collect_invalid_repo_paths(&bundle.repositories);
    let warnings = collect_import_warnings(&repo_conflicts, &invalid_repo_paths);
    let settings_changes = diff_settings_keys(&current_settings, &bundle.settings);
    let (logs_directory_status, logs_directory) = describe_logs_directory_status(&bundle.settings);

    Ok(ConfigImportPreview {
        source: source.to_string(),
        version: bundle.version,
        exported_at: bundle.exported_at,
        repository_count: bundle.repositories.len(),
        task_count: bundle.tasks.len(),
        invalid_repo_paths,
        repo_conflicts,
        warnings,
        settings_changes,
        logs_directory_status,
        logs_directory,
    })
}

/// Import configuration from a file
pub fn import_config(app: &AppHandle, request: &ConfigImportRequest) -> AppResult<ConfigImportResult> {
    let mut bundle = load_import_bundle(&request.source)?;
    let current_settings = super::settings::load_settings(app)?;
    let current_repositories = super::repositories::load_repositories(app)?;
    let current_tasks = super::tasks::load_tasks(app)?;

    let replaced_path_count = apply_path_prefix_replacements(&mut bundle.repositories, &request.path_prefix_replacements);
    let repo_conflicts = collect_repo_conflicts(&current_repositories, &bundle.repositories);
    let conflict_count = repo_conflicts.len();

    let should_apply_settings = matches!(request.strategy, ImportStrategy::Merge | ImportStrategy::Overwrite | ImportStrategy::SettingsOnly);
    let should_apply_repositories = matches!(request.strategy, ImportStrategy::Merge | ImportStrategy::Overwrite | ImportStrategy::RepositoriesOnly);
    let should_apply_tasks = matches!(request.strategy, ImportStrategy::Merge | ImportStrategy::Overwrite);

    let skipped_logs_directory = if should_apply_settings {
        match normalize_optional_string(bundle.settings.logs_directory.as_deref()) {
            Some(directory) => match validate_logs_directory(&directory) {
                Ok(validated) => { bundle.settings.logs_directory = Some(validated); None }
                Err(_) => { bundle.settings.logs_directory = None; Some(directory) }
            },
            None => { bundle.settings.logs_directory = None; None }
        }
    } else { None };

    let next_settings = match request.strategy {
        ImportStrategy::Overwrite | ImportStrategy::SettingsOnly => super::settings::normalize_settings(bundle.settings.clone()),
        ImportStrategy::Merge => super::settings::normalize_settings(merge_settings(current_settings.clone(), &bundle.settings)),
        ImportStrategy::RepositoriesOnly => current_settings.clone(),
    };

    let mut next_repositories = if should_apply_repositories {
        match request.strategy {
            ImportStrategy::Overwrite => bundle.repositories.clone(),
            ImportStrategy::Merge | ImportStrategy::RepositoriesOnly => merge_repositories(current_repositories.clone(), &bundle.repositories, request.skip_conflicts),
            ImportStrategy::SettingsOnly => current_repositories.clone(),
        }
    } else { current_repositories.clone() };

    let mut next_tasks = if should_apply_tasks {
        match request.strategy {
            ImportStrategy::Overwrite => bundle.tasks.clone(),
            ImportStrategy::Merge => merge_tasks(current_tasks.clone(), &bundle.tasks),
            ImportStrategy::RepositoriesOnly | ImportStrategy::SettingsOnly => current_tasks.clone(),
        }
    } else { current_tasks.clone() };

    super::repositories::sort_repositories(&mut next_repositories);
    super::tasks::sort_tasks(&mut next_tasks);
    let invalid_repo_paths = collect_invalid_repo_paths(&next_repositories);
    let warnings = collect_import_warnings(&repo_conflicts, &invalid_repo_paths);

    let paths = super::settings::ensure_storage(app)?;
    let backup_directory = create_backup_snapshot(&paths)?;

    let write_result = save_json(&paths.config_file, &next_settings).map_err(map_config_write_error)
        .and_then(|_| save_json(&paths.repositories_file, &next_repositories).map_err(map_config_write_error))
        .and_then(|_| save_json(&paths.tasks_file, &next_tasks).map_err(map_config_write_error));

    if let Err(error) = write_result {
        let rollback_result = restore_backup_snapshot(&paths, &backup_directory);
        let detail = match rollback_result {
            Ok(()) => error.detail.unwrap_or(error.message),
            Err(rollback_error) => format!("{}；回滚也失败：{}", error.detail.unwrap_or(error.message), rollback_error.detail.unwrap_or(rollback_error.message)),
        };
        return Err(AppError::new("SD-MIG-004", NoticeLevel::Info, "配置回滚完成", "导入失败，已自动恢复到导入前配置。")
            .with_detail(detail)
            .with_action("检查导入文件后重试"));
    }

    Ok(ConfigImportResult {
        repository_count: next_repositories.len(),
        task_count: next_tasks.len(),
        invalid_repo_paths,
        skipped_logs_directory,
        backup_directory: backup_directory.to_string_lossy().to_string(),
        conflict_count,
        replaced_path_count,
        warnings,
        applied_strategy: request.strategy.clone(),
    })
}

// Internal helper functions

fn load_import_bundle(source: &str) -> AppResult<ConfigTransferBundle> {
    let path = std::path::PathBuf::from(source.trim());
    if !path.exists() {
        return Err(AppError::new("SD-MIG-001", NoticeLevel::Error, "导入文件不存在", "指定的配置包文件不存在。")
            .with_detail(source.to_string())
            .with_action("选择有效的配置文件"));
    }
    load_json_or_default(&path)
}

fn collect_repo_conflicts(current: &[RepositoryRecord], incoming: &[RepositoryRecord]) -> Vec<ImportRepoConflict> {
    let mut conflicts = Vec::new();
    for incoming_repo in incoming {
        let normalized_path = incoming_repo.path.replace('\\', "/").trim_end_matches('/').to_lowercase();
        for current_repo in current {
            if current_repo.path.replace('\\', "/").trim_end_matches('/').to_lowercase() == normalized_path {
                conflicts.push(ImportRepoConflict {
                    path: incoming_repo.path.clone(),
                    existing_name: current_repo.name.clone(),
                    existing_group: current_repo.group.clone(),
                    incoming_name: incoming_repo.name.clone(),
                    incoming_group: incoming_repo.group.clone(),
                });
                break;
            }
        }
    }
    conflicts
}

fn collect_invalid_repo_paths(repositories: &[RepositoryRecord]) -> Vec<String> {
    repositories.iter()
        .filter(|repo| !Path::new(&repo.path).exists())
        .map(|repo| repo.path.clone())
        .collect()
}

fn collect_import_warnings(conflicts: &[ImportRepoConflict], invalid_paths: &[String]) -> Vec<InlineNotice> {
    let mut warnings = Vec::new();
    for conflict in conflicts {
        warnings.push(InlineNotice {
            level: NoticeLevel::Warning,
            code: "SD-MIG-101".to_string(),
            title: "仓库路径冲突".to_string(),
            message: format!("路径 {} 已存在（当前：{} / {}，导入：{} / {}）",
                conflict.path, conflict.existing_name, conflict.existing_group,
                conflict.incoming_name, conflict.incoming_group),
            action: Some("选择合适的导入策略".to_string()),
            detail: None,
            repo_id: None,
            task_id: None,
            retryable: false,
        });
    }
    for path in invalid_paths {
        warnings.push(InlineNotice {
            level: NoticeLevel::Warning,
            code: "SD-MIG-102".to_string(),
            title: "路径不可访问".to_string(),
            message: format!("仓库路径 {} 在当前设备不存在", path),
            action: Some("导入后重新定位仓库".to_string()),
            detail: None,
            repo_id: None,
            task_id: None,
            retryable: false,
        });
    }
    warnings
}

fn diff_settings_keys(current: &AppSettings, incoming: &AppSettings) -> Vec<String> {
    let mut changes = Vec::new();
    if current.concurrent_limit != incoming.concurrent_limit { changes.push("concurrentLimit".to_string()); }
    if current.command_timeout_secs != incoming.command_timeout_secs { changes.push("commandTimeoutSecs".to_string()); }
    if current.skip_untracked_files != incoming.skip_untracked_files { changes.push("skipUntrackedFiles".to_string()); }
    if current.show_debug_logs != incoming.show_debug_logs { changes.push("showDebugLogs".to_string()); }
    if current.log_retention_days != incoming.log_retention_days { changes.push("logRetentionDays".to_string()); }
    if current.logs_directory != incoming.logs_directory { changes.push("logsDirectory".to_string()); }
    if current.default_view != incoming.default_view { changes.push("defaultView".to_string()); }
    if current.theme_mode != incoming.theme_mode { changes.push("themeMode".to_string()); }
    if current.language_mode != incoming.language_mode { changes.push("languageMode".to_string()); }
    changes
}

fn describe_logs_directory_status(settings: &AppSettings) -> (String, Option<String>) {
    match normalize_optional_string(settings.logs_directory.as_deref()) {
        Some(directory) => {
            if Path::new(&directory).exists() {
                ("ok".to_string(), Some(directory))
            } else {
                ("invalid".to_string(), Some(directory))
            }
        }
        None => ("unspecified".to_string(), None),
    }
}

fn apply_path_prefix_replacements(repositories: &mut [RepositoryRecord], replacements: &[PathPrefixReplacement]) -> usize {
    let mut count = 0;
    for repo in repositories.iter_mut() {
        for replacement in replacements {
            let from = replacement.from.trim();
            let to = replacement.to.trim();
            if !from.is_empty() && !to.is_empty() && repo.path.starts_with(from) {
                repo.path = format!("{}{}", to, &repo.path[from.len()..]);
                count += 1;
            }
        }
    }
    count
}

fn merge_settings(current: AppSettings, incoming: &AppSettings) -> AppSettings {
    AppSettings {
        concurrent_limit: incoming.concurrent_limit,
        command_timeout_secs: incoming.command_timeout_secs,
        auto_retry_transient_failures: incoming.auto_retry_transient_failures,
        skip_untracked_files: incoming.skip_untracked_files,
        show_debug_logs: incoming.show_debug_logs,
        log_retention_days: incoming.log_retention_days,
        logs_directory: current.logs_directory.or(incoming.logs_directory.clone()),
        default_view: incoming.default_view.clone(),
        theme_mode: current.theme_mode,
        language_mode: current.language_mode,
        sync_mode: incoming.sync_mode.clone(),
    }
}

fn merge_repositories(current: Vec<RepositoryRecord>, incoming: &[RepositoryRecord], skip_conflicts: bool) -> Vec<RepositoryRecord> {
    let mut result = current;
    for incoming_repo in incoming {
        let normalized_path = incoming_repo.path.replace('\\', "/").trim_end_matches('/').to_lowercase();
        let conflict_index = result.iter().position(|r| {
            r.path.replace('\\', "/").trim_end_matches('/').to_lowercase() == normalized_path
        });
        match conflict_index {
            Some(index) if !skip_conflicts => { result[index] = incoming_repo.clone(); }
            Some(_) => {}
            None => { result.push(incoming_repo.clone()); }
        }
    }
    result
}

fn merge_tasks(current: Vec<SyncTaskRecord>, incoming: &[SyncTaskRecord]) -> Vec<SyncTaskRecord> {
    let mut result = current;
    for incoming_task in incoming {
        if !result.iter().any(|t| t.task_id == incoming_task.task_id) {
            result.push(incoming_task.clone());
        }
    }
    result
}

fn create_backup_snapshot(paths: &super::paths::StoragePaths) -> AppResult<std::path::PathBuf> {
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let backup_dir = paths.backup_dir.join(format!("import_{}", timestamp));
    fs::create_dir_all(&backup_dir).map_err(|e| AppError::internal(format!("Failed to create backup directory: {}", e)))?;
    if paths.config_file.exists() {
        fs::copy(&paths.config_file, backup_dir.join("config.json")).map_err(|e| AppError::internal(format!("Failed to backup config: {}", e)))?;
    }
    if paths.repositories_file.exists() {
        fs::copy(&paths.repositories_file, backup_dir.join("repositories.json")).map_err(|e| AppError::internal(format!("Failed to backup repositories: {}", e)))?;
    }
    if paths.tasks_file.exists() {
        fs::copy(&paths.tasks_file, backup_dir.join("tasks.json")).map_err(|e| AppError::internal(format!("Failed to backup tasks: {}", e)))?;
    }
    Ok(backup_dir)
}

fn restore_backup_snapshot(paths: &super::paths::StoragePaths, backup_dir: &Path) -> AppResult<()> {
    let config_backup = backup_dir.join("config.json");
    if config_backup.exists() {
        fs::copy(&config_backup, &paths.config_file).map_err(|e| AppError::internal(format!("Failed to restore config: {}", e)))?;
    }
    let repos_backup = backup_dir.join("repositories.json");
    if repos_backup.exists() {
        fs::copy(&repos_backup, &paths.repositories_file).map_err(|e| AppError::internal(format!("Failed to restore repositories: {}", e)))?;
    }
    let tasks_backup = backup_dir.join("tasks.json");
    if tasks_backup.exists() {
        fs::copy(&tasks_backup, &paths.tasks_file).map_err(|e| AppError::internal(format!("Failed to restore tasks: {}", e)))?;
    }
    Ok(())
}

// Error mapping functions

fn map_config_write_error(error: AppError) -> AppError {
    error.with_code("SD-CFG-001").with_title("设置保存失败")
}

fn map_migration_export_error(error: AppError) -> AppError {
    error.with_code("SD-MIG-002").with_title("配置导出失败")
}
