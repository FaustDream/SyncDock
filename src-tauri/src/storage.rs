use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chrono::Utc;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    errors::{AppError, AppResult},
    models::{
        AppSettings, ConfigExportResult, ConfigImportPreview, ConfigImportRequest,
        ConfigImportResult, ConfigTransferBundle, ImportRepoConflict, ImportStrategy,
        InlineNotice, LogCleanupResult, LogsDiagnostics, NoticeLevel, PathPrefixReplacement,
        RepositoryRecord, SyncTaskRecord,
    },
};


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


pub fn resolve_storage_paths(app: &AppHandle) -> AppResult<StoragePaths> {
    let mut paths = resolve_base_paths(app)?;
    prepare_base_storage(&paths)?;

    let settings = load_json_or_default::<AppSettings>(&paths.config_file)?;
    let normalized = normalize_settings(settings);
    paths.logs_dir = resolve_effective_logs_dir(normalized.logs_directory.as_deref(), &paths.logs_dir);
    fs::create_dir_all(&paths.logs_dir).map_err(map_log_directory_error)?;
    Ok(paths)
}

pub fn ensure_storage(app: &AppHandle) -> AppResult<StoragePaths> {
    resolve_storage_paths(app)
}

pub fn load_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let paths = ensure_storage(app)?;
    Ok(normalize_settings(load_json_or_default::<AppSettings>(
        &paths.config_file,
    )?))
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    let sanitized = sanitize_settings(settings)?;
    save_json(&paths.config_file, &sanitized).map_err(map_config_write_error)
}

pub fn set_config_directory(app: &AppHandle, directory: Option<&str>) -> AppResult<StoragePaths> {
    let current_paths = ensure_storage(app)?;
    let default_root = default_storage_root(app)?;
    let requested_root = match normalize_optional_string(directory) {
        Some(path) => PathBuf::from(validate_config_directory(&path)?),
        None => default_root.clone(),
    };

    if !path_equals(&current_paths.root, &requested_root) {
        let target_paths = build_storage_paths(requested_root.clone());
        prepare_base_storage(&target_paths)?;
        migrate_storage_directory(&current_paths, &target_paths)
            .map_err(map_config_directory_change_error)?;
    }

    save_storage_directory_config(
        app,
        if path_equals(&requested_root, &default_root) {
            None
        } else {
            Some(requested_root.as_path())
        },
    )?;

    resolve_storage_paths(app)
}

pub fn load_repositories(app: &AppHandle) -> AppResult<Vec<RepositoryRecord>> {

    let paths = ensure_storage(app)?;
    load_json_or_default::<Vec<RepositoryRecord>>(&paths.repositories_file)
}

pub fn save_repositories(app: &AppHandle, repositories: &[RepositoryRecord]) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    save_json(&paths.repositories_file, &repositories.to_vec()).map_err(map_config_write_error)
}

pub fn load_tasks(app: &AppHandle) -> AppResult<Vec<SyncTaskRecord>> {
    let paths = ensure_storage(app)?;
    load_json_or_default::<Vec<SyncTaskRecord>>(&paths.tasks_file)
}

pub fn save_tasks(app: &AppHandle, tasks: &[SyncTaskRecord]) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    save_json(&paths.tasks_file, &tasks.to_vec()).map_err(|error| {
        AppError::new(
            "SD-SYNC-005",
            NoticeLevel::Error,
            "同步结果写入失败",
            "同步已执行，但结果保存失败，请检查本地配置目录。",
        )
        .with_detail(error.detail.unwrap_or(error.message))
        .with_action("检查目录权限")
    })
}

pub fn append_task_log(app: &AppHandle, task_id: &str, line: &str) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    let log_path = task_log_path(&paths, task_id);
    append_log_line(&log_path, line)
}

pub fn read_task_log(app: &AppHandle, task_id: &str) -> AppResult<String> {
    let paths = ensure_storage(app)?;
    read_log_file(&task_log_path(&paths, task_id))
}

pub fn export_task_log(app: &AppHandle, task_id: &str, destination: &str) -> AppResult<String> {
    let target_path = ensure_export_file_path(destination, "log")?;
    let content = read_task_log(app, task_id)?;
    save_text_file(&target_path, &content).map_err(map_log_export_error)?;
    Ok(target_path.to_string_lossy().to_string())
}

pub fn append_repository_log(app: &AppHandle, repo_id: &str, line: &str) -> AppResult<()> {
    let paths = ensure_storage(app)?;
    let log_path = repository_log_path(&paths, repo_id);
    append_log_line(&log_path, line)
}

pub fn read_repository_log(app: &AppHandle, repo_id: &str) -> AppResult<String> {
    let paths = ensure_storage(app)?;
    read_log_file(&repository_log_path(&paths, repo_id))
}

pub fn export_repository_log(app: &AppHandle, repo_id: &str, destination: &str) -> AppResult<String> {
    let target_path = ensure_export_file_path(destination, "log")?;
    let content = read_repository_log(app, repo_id)?;
    save_text_file(&target_path, &content).map_err(map_log_export_error)?;
    Ok(target_path.to_string_lossy().to_string())
}

pub fn get_logs_diagnostics(app: &AppHandle) -> AppResult<LogsDiagnostics> {
    let paths = ensure_storage(app)?;
    let settings = load_settings(app)?;
    let configured_directory = normalize_optional_string(settings.logs_directory.as_deref());
    let using_custom_directory = configured_directory
        .as_deref()
        .map(|value| path_equals(Path::new(value), &paths.logs_dir))
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

pub fn cleanup_logs(app: &AppHandle) -> AppResult<LogCleanupResult> {
    let paths = ensure_storage(app)?;
    let settings = load_settings(app)?;
    if settings.log_retention_days == 0 {
        return Ok(LogCleanupResult {
            removed_files: 0,
            freed_bytes: 0,
            directory: paths.logs_dir.to_string_lossy().to_string(),
        });
    }

    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(u64::from(settings.log_retention_days) * 24 * 60 * 60))
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let mut removed_files = 0usize;
    let mut freed_bytes = 0u64;

    let entries = fs::read_dir(&paths.logs_dir).map_err(map_log_cleanup_error)?;

    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let Ok(modified_at) = metadata.modified() else {
            continue;
        };
        if modified_at >= cutoff {
            continue;
        }

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

pub fn export_config(app: &AppHandle, destination: &str) -> AppResult<ConfigExportResult> {
    let target_path = ensure_export_file_path(destination, "json")?;
    let mut repositories = load_repositories(app)?;
    let mut tasks = load_tasks(app)?;
    sort_repositories(&mut repositories);
    sort_tasks(&mut tasks);

    let bundle = ConfigTransferBundle {
        version: 2,
        exported_at: Utc::now().to_rfc3339(),
        settings: load_settings(app)?,
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

pub fn preview_config_import(app: &AppHandle, source: &str) -> AppResult<ConfigImportPreview> {
    let bundle = load_import_bundle(source)?;
    let current_settings = load_settings(app)?;
    let current_repositories = load_repositories(app)?;
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


pub fn import_config(app: &AppHandle, request: &ConfigImportRequest) -> AppResult<ConfigImportResult> {
    let mut bundle = load_import_bundle(&request.source)?;
    let current_settings = load_settings(app)?;
    let current_repositories = load_repositories(app)?;
    let current_tasks = load_tasks(app)?;

    let replaced_path_count = apply_path_prefix_replacements(
        &mut bundle.repositories,
        &request.path_prefix_replacements,
    );
    let repo_conflicts = collect_repo_conflicts(&current_repositories, &bundle.repositories);
    let conflict_count = repo_conflicts.len();

    let should_apply_settings = matches!(
        request.strategy,
        ImportStrategy::Merge | ImportStrategy::Overwrite | ImportStrategy::SettingsOnly
    );
    let should_apply_repositories = matches!(
        request.strategy,
        ImportStrategy::Merge | ImportStrategy::Overwrite | ImportStrategy::RepositoriesOnly
    );
    let should_apply_tasks = matches!(request.strategy, ImportStrategy::Merge | ImportStrategy::Overwrite);

    let skipped_logs_directory = if should_apply_settings {
        match normalize_optional_string(bundle.settings.logs_directory.as_deref()) {
            Some(directory) => match validate_logs_directory(&directory) {
                Ok(validated) => {
                    bundle.settings.logs_directory = Some(validated);
                    None
                }
                Err(_) => {
                    bundle.settings.logs_directory = None;
                    Some(directory)
                }
            },
            None => {
                bundle.settings.logs_directory = None;
                None
            }
        }
    } else {
        None
    };

    let next_settings = match request.strategy {
        ImportStrategy::Overwrite | ImportStrategy::SettingsOnly => {
            sanitize_settings(&bundle.settings)?
        }
        ImportStrategy::Merge => sanitize_settings(&merge_settings(current_settings.clone(), &bundle.settings))?,
        ImportStrategy::RepositoriesOnly => current_settings.clone(),
    };

    let mut next_repositories = if should_apply_repositories {
        match request.strategy {
            ImportStrategy::Overwrite => bundle.repositories.clone(),
            ImportStrategy::Merge | ImportStrategy::RepositoriesOnly => merge_repositories(
                current_repositories.clone(),
                &bundle.repositories,
                request.skip_conflicts,
            ),
            ImportStrategy::SettingsOnly => current_repositories.clone(),
        }
    } else {
        current_repositories.clone()
    };

    let mut next_tasks = if should_apply_tasks {
        match request.strategy {
            ImportStrategy::Overwrite => bundle.tasks.clone(),
            ImportStrategy::Merge => merge_tasks(current_tasks.clone(), &bundle.tasks),
            ImportStrategy::RepositoriesOnly | ImportStrategy::SettingsOnly => current_tasks.clone(),
        }
    } else {
        current_tasks.clone()
    };

    sort_repositories(&mut next_repositories);
    sort_tasks(&mut next_tasks);
    let invalid_repo_paths = collect_invalid_repo_paths(&next_repositories);
    let warnings = collect_import_warnings(&repo_conflicts, &invalid_repo_paths);

    let paths = ensure_storage(app)?;

    let backup_directory = create_backup_snapshot(&paths)?;

    let write_result = save_json(&paths.config_file, &next_settings)
        .map_err(map_config_write_error)
        .and_then(|_| save_json(&paths.repositories_file, &next_repositories).map_err(map_config_write_error))
        .and_then(|_| save_json(&paths.tasks_file, &next_tasks).map_err(map_config_write_error));

    if let Err(error) = write_result {
        let rollback_result = restore_backup_snapshot(&paths, &backup_directory);
        let detail = match rollback_result {
            Ok(()) => error.detail.unwrap_or(error.message),
            Err(rollback_error) => format!(
                "{}；回滚也失败：{}",
                error.detail.unwrap_or(error.message),
                rollback_error.detail.unwrap_or(rollback_error.message)
            ),
        };
        return Err(
            AppError::new(
                "SD-MIG-004",
                NoticeLevel::Info,
                "配置回滚完成",
                "导入失败，已自动恢复到导入前配置。",
            )

            .with_detail(detail)
            .with_action("检查导入文件后重试"),
        );
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


pub fn sort_repositories(repositories: &mut [RepositoryRecord]) {
    repositories.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
}

pub fn sort_tasks(tasks: &mut [SyncTaskRecord]) {
    tasks.sort_by(|left, right| right.start_time.cmp(&left.start_time));
}

fn migrate_storage_directory(current_paths: &StoragePaths, target_paths: &StoragePaths) -> AppResult<()> {
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

fn default_storage_root(app: &AppHandle) -> AppResult<PathBuf> {

    Ok(app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| {
            AppError::new(
                "SD-ENV-004",
                NoticeLevel::Fatal,
                "应用目录不可写",
                "无法解析应用配置目录。",
            )
        })?
        .join("syncdock"))
}

fn build_storage_paths(root: PathBuf) -> StoragePaths {
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

fn resolve_base_paths(app: &AppHandle) -> AppResult<StoragePaths> {
    let default_root = default_storage_root(app)?;
    let configured_root = load_storage_directory_config(app)?
        .map(PathBuf::from)
        .unwrap_or_else(|| default_root.clone());

    Ok(build_storage_paths(configured_root))
}

fn storage_directory_config_file(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(default_storage_root(app)?.join(STORAGE_DIRECTORY_FILE_NAME))
}

fn load_storage_directory_config(app: &AppHandle) -> AppResult<Option<String>> {
    let path = storage_directory_config_file(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let config = load_json_or_default::<StorageDirectoryConfig>(&path)?;
    match normalize_optional_string(config.config_directory.as_deref()) {
        Some(directory) => Ok(Some(validate_config_directory(&directory)?)),
        None => Ok(None),
    }
}

fn save_storage_directory_config(app: &AppHandle, directory: Option<&Path>) -> AppResult<()> {
    let default_root = default_storage_root(app)?;
    fs::create_dir_all(&default_root).map_err(map_config_directory_error)?;
    let path = default_root.join(STORAGE_DIRECTORY_FILE_NAME);

    match directory {
        Some(directory) => save_json(
            &path,
            &StorageDirectoryConfig {
                config_directory: Some(directory.to_string_lossy().to_string()),
            },
        )
        .map_err(map_config_directory_change_error),
        None => {
            if path.exists() {
                fs::remove_file(&path).map_err(map_config_directory_error)?;
            }
            Ok(())
        }
    }
}


fn prepare_base_storage(paths: &StoragePaths) -> AppResult<()> {
    fs::create_dir_all(&paths.root).map_err(|error| {
        AppError::new(
            "SD-ENV-004",
            NoticeLevel::Fatal,
            "应用目录不可写",
            "应用配置目录不可写，无法保存配置和日志。",
        )
        .with_detail(error.to_string())
        .with_action("检查目录权限")
    })?;
    fs::create_dir_all(&paths.logs_dir).map_err(map_log_directory_error)?;
    fs::create_dir_all(&paths.crash_dir)?;
    fs::create_dir_all(&paths.backup_dir)?;

    if !paths.config_file.exists() {
        save_json(&paths.config_file, &AppSettings::default())?;
    }
    if !paths.repositories_file.exists() {
        save_json(&paths.repositories_file, &Vec::<RepositoryRecord>::new())?;
    }
    if !paths.tasks_file.exists() {
        save_json(&paths.tasks_file, &Vec::<SyncTaskRecord>::new())?;
    }

    Ok(())
}

fn normalize_settings(mut settings: AppSettings) -> AppSettings {
    settings.concurrent_limit = settings.concurrent_limit.clamp(1, 5);
    settings.command_timeout_secs = settings.command_timeout_secs.clamp(10, 300);
    settings.log_retention_days = match settings.log_retention_days {
        0 => 0,
        days => days.clamp(1, 90),
    };
    settings.scan_depth = settings.scan_depth.clamp(1, 12);

    settings.logs_directory = normalize_optional_string(settings.logs_directory.as_deref());
    settings.default_scan_root = normalize_optional_string(settings.default_scan_root.as_deref());
    settings.ignored_directories = settings
        .ignored_directories
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
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



fn sanitize_settings(settings: &AppSettings) -> AppResult<AppSettings> {
    let mut sanitized = normalize_settings(settings.clone());
    if let Some(directory) = sanitized.logs_directory.clone() {
        sanitized.logs_directory = Some(validate_logs_directory(&directory)?);
    }
    Ok(sanitized)
}

fn validate_config_directory(path: &str) -> AppResult<String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err(
            AppError::new(
                "SD-CFG-004",
                NoticeLevel::Error,
                "配置目录无效",
                "当前配置目录不可用，请重新选择可读写位置。",
            )
            .with_action("重新选择绝对路径"),
        );
    }

    ensure_directory_writable(&candidate).map_err(|error| {
        AppError::new(
            "SD-CFG-004",
            NoticeLevel::Error,
            "配置目录无效",
            "当前配置目录不可用，请重新选择可读写位置。",
        )
        .with_detail(error.detail.unwrap_or(error.message))
        .with_action("重新选择目录")
    })?;

    Ok(candidate.to_string_lossy().to_string())
}

fn resolve_effective_logs_dir(configured: Option<&str>, default_dir: &Path) -> PathBuf {

    let Some(directory) = normalize_optional_string(configured) else {
        return default_dir.to_path_buf();
    };

    let candidate = PathBuf::from(&directory);
    if ensure_directory_writable(&candidate).is_ok() {
        candidate
    } else {
        default_dir.to_path_buf()
    }
}

fn validate_logs_directory(path: &str) -> AppResult<String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute() {
        return Err(
            AppError::new(
                "SD-LOG-001",
                NoticeLevel::Error,
                "日志目录无效",
                "当前日志目录不可用，请重新选择可读写位置。",
            )
            .with_action("重新选择绝对路径"),
        );
    }

    ensure_directory_writable(&candidate).map_err(|error| {
        AppError::new(
            "SD-LOG-001",
            NoticeLevel::Error,
            "日志目录无效",
            "当前日志目录不可用，请重新选择可读写位置。",
        )
        .with_detail(error.detail.unwrap_or(error.message))
        .with_action("重新选择目录")
    })?;

    Ok(candidate.to_string_lossy().to_string())
}

fn ensure_directory_writable(directory: &Path) -> AppResult<()> {
    fs::create_dir_all(directory).map_err(map_log_directory_error)?;
    let probe_path = directory.join(format!(".syncdock-write-test-{}", Utc::now().timestamp_millis()));
    fs::write(&probe_path, b"syncdock").map_err(map_log_directory_error)?;
    let _ = fs::remove_file(&probe_path);
    Ok(())
}

fn is_directory_writable(directory: &Path) -> bool {
    ensure_directory_writable(directory).is_ok()
}

fn ensure_export_file_path(destination: &str, extension: &str) -> AppResult<PathBuf> {
    let trimmed = destination.trim();
    if trimmed.is_empty() {
        return Err(AppError::internal("导出路径为空"));
    }

    let mut path = PathBuf::from(trimmed);
    if path.extension().is_none() {
        path.set_extension(extension);
    }

    let Some(parent) = path.parent() else {
        return Err(AppError::internal("导出路径无父级目录"));
    };
    fs::create_dir_all(parent)?;
    Ok(path)
}

fn create_backup_snapshot(paths: &StoragePaths) -> AppResult<PathBuf> {
    let backup_directory = paths
        .backup_dir
        .join(format!("import-{}", Utc::now().format("%Y%m%d-%H%M%S")));
    fs::create_dir_all(&backup_directory)?;

    copy_file_if_exists(&paths.config_file, &backup_directory.join("config.json"))?;
    copy_file_if_exists(&paths.repositories_file, &backup_directory.join("repositories.json"))?;
    copy_file_if_exists(&paths.tasks_file, &backup_directory.join("tasks.json"))?;

    Ok(backup_directory)
}

fn restore_backup_snapshot(paths: &StoragePaths, backup_directory: &Path) -> AppResult<()> {
    copy_file_if_exists(&backup_directory.join("config.json"), &paths.config_file)?;
    copy_file_if_exists(
        &backup_directory.join("repositories.json"),
        &paths.repositories_file,
    )?;
    copy_file_if_exists(&backup_directory.join("tasks.json"), &paths.tasks_file)?;
    Ok(())
}

fn load_import_bundle(source: &str) -> AppResult<ConfigTransferBundle> {
    let source_path = PathBuf::from(source.trim());
    if !source_path.exists() {
        return Err(
            AppError::new(
                "SD-MIG-001",
                NoticeLevel::Error,
                "导入文件无效",
                "导入失败，文件格式无效或内容不完整。",
            )
            .with_action("重新选择文件"),
        );
    }

    let content = fs::read_to_string(&source_path).map_err(map_migration_import_error)?;
    let bundle: ConfigTransferBundle = serde_json::from_str(&content).map_err(|error| {
        AppError::new(
            "SD-MIG-001",
            NoticeLevel::Error,
            "导入文件无效",
            "导入失败，文件格式无效或内容不完整。",
        )
        .with_detail(error.to_string())
        .with_action("重新选择文件")
    })?;

    if bundle.version == 0 {
        return Err(
            AppError::new(
                "SD-MIG-001",
                NoticeLevel::Error,
                "导入文件无效",
                "导入失败，文件格式无效或内容不完整。",
            )
            .with_action("重新选择文件"),
        );
    }

    Ok(bundle)
}

fn collect_repo_conflicts(current: &[RepositoryRecord], incoming: &[RepositoryRecord]) -> Vec<ImportRepoConflict> {
    incoming
        .iter()
        .filter_map(|repo| {
            current
                .iter()
                .find(|current_repo| same_path(&current_repo.path, &repo.path))
                .map(|current_repo| ImportRepoConflict {
                    path: repo.path.clone(),
                    existing_name: current_repo.name.clone(),
                    incoming_name: repo.name.clone(),
                    existing_group: current_repo.group.clone(),
                    incoming_group: repo.group.clone(),
                })
        })
        .collect()
}

fn collect_invalid_repo_paths(repositories: &[RepositoryRecord]) -> Vec<String> {
    repositories
        .iter()
        .filter(|repo| !Path::new(&repo.path).exists())
        .map(|repo| repo.path.clone())
        .collect()
}

fn diff_settings_keys(current: &AppSettings, incoming: &AppSettings) -> Vec<String> {
    let current = normalize_settings(current.clone());
    let incoming = normalize_settings(incoming.clone());
    let mut changes = Vec::new();

    if current.concurrent_limit != incoming.concurrent_limit {
        changes.push("并发数".to_string());
    }
    if current.command_timeout_secs != incoming.command_timeout_secs {
        changes.push("命令超时".to_string());
    }
    if current.skip_untracked_files != incoming.skip_untracked_files {
        changes.push("未跟踪文件策略".to_string());
    }
    if current.show_debug_logs != incoming.show_debug_logs {
        changes.push("调试日志保留".to_string());
    }
    if current.log_retention_days != incoming.log_retention_days {
        changes.push("日志保留天数".to_string());
    }
    if current.logs_directory != incoming.logs_directory {
        changes.push("日志目录".to_string());
    }
    if current.default_scan_root != incoming.default_scan_root {
        changes.push("默认扫描目录".to_string());
    }
    if current.ignored_directories != incoming.ignored_directories {
        changes.push("忽略目录".to_string());
    }
    if current.scan_depth != incoming.scan_depth {
        changes.push("扫描深度".to_string());
    }
    if current.default_view != incoming.default_view {
        changes.push("默认启动页".to_string());
    }
    if current.theme_mode != incoming.theme_mode {
        changes.push("主题模式".to_string());
    }
    if current.language_mode != incoming.language_mode {
        changes.push("界面语言".to_string());
    }

    changes


}

fn describe_logs_directory_status(settings: &AppSettings) -> (String, Option<String>) {
    match normalize_optional_string(settings.logs_directory.as_deref()) {
        Some(directory) => {
            if validate_logs_directory(&directory).is_ok() {
                ("ok".into(), Some(directory))
            } else {
                ("invalid".into(), Some(directory))
            }
        }
        None => ("empty".into(), None),
    }
}

fn collect_import_warnings(
    repo_conflicts: &[ImportRepoConflict],
    invalid_repo_paths: &[String],
) -> Vec<InlineNotice> {
    let mut warnings = Vec::new();

    if !repo_conflicts.is_empty() {
        warnings.push(
            AppError::new(
                "SD-MIG-002",
                NoticeLevel::Warning,
                "导入冲突",
                "导入内容与当前配置存在冲突，请确认导入策略。",
            )
            .with_action("查看冲突仓库")
            .with_detail(format!("检测到 {} 个仓库路径冲突。", repo_conflicts.len()))
            .into_inline_notice(),
        );
    }

    if !invalid_repo_paths.is_empty() {
        warnings.push(
            AppError::new(
                "SD-MIG-003",
                NoticeLevel::Warning,
                "路径迁移失败",
                "部分仓库路径在当前设备无效，请重新定位。",
            )
            .with_action("查看无效路径")
            .with_detail(format!("当前仍有 {} 个仓库路径不可用。", invalid_repo_paths.len()))
            .into_inline_notice(),
        );
    }

    warnings
}


fn merge_settings(current: AppSettings, incoming: &AppSettings) -> AppSettings {
    let current = normalize_settings(current);
    let incoming = normalize_settings(incoming.clone());

    AppSettings {
        concurrent_limit: incoming.concurrent_limit,
        command_timeout_secs: incoming.command_timeout_secs,
        skip_untracked_files: incoming.skip_untracked_files,
        show_debug_logs: incoming.show_debug_logs,
        log_retention_days: incoming.log_retention_days,
        logs_directory: incoming.logs_directory.or(current.logs_directory),
        default_scan_root: incoming.default_scan_root.or(current.default_scan_root),
        ignored_directories: if incoming.ignored_directories.is_empty() {
            current.ignored_directories
        } else {
            incoming.ignored_directories
        },
        scan_depth: incoming.scan_depth,
        default_view: incoming.default_view,
        theme_mode: incoming.theme_mode,
        language_mode: incoming.language_mode,
    }
}



fn merge_repositories(
    mut current: Vec<RepositoryRecord>,
    incoming: &[RepositoryRecord],
    skip_conflicts: bool,
) -> Vec<RepositoryRecord> {
    for imported in incoming {
        if let Some(existing) = current.iter_mut().find(|repo| same_path(&repo.path, &imported.path)) {
            if skip_conflicts {
                continue;
            }
            existing.name = imported.name.clone();
            existing.group = imported.group.clone();
            existing.note = imported.note.clone();
            existing.enabled = imported.enabled;
            existing.remote_url = imported.remote_url.clone();
            existing.path = imported.path.clone();
            continue;
        }
        current.push(imported.clone());
    }
    current
}

fn merge_tasks(mut current: Vec<SyncTaskRecord>, incoming: &[SyncTaskRecord]) -> Vec<SyncTaskRecord> {
    for task in incoming {
        if let Some(existing) = current.iter_mut().find(|item| item.task_id == task.task_id) {
            *existing = task.clone();
        } else {
            current.push(task.clone());
        }
    }
    sort_tasks(&mut current);
    if current.len() > 120 {
        current.truncate(120);
    }
    current
}

fn apply_path_prefix_replacements(
    repositories: &mut [RepositoryRecord],
    replacements: &[PathPrefixReplacement],
) -> usize {
    let mut replaced_count = 0usize;
    for repo in repositories {
        for replacement in replacements {
            if let Some(next_path) = replace_path_prefix(&repo.path, &replacement.from, &replacement.to) {
                if next_path != repo.path {
                    repo.path = next_path;
                    replaced_count += 1;
                }
                break;
            }
        }
    }
    replaced_count
}

fn replace_path_prefix(path: &str, from: &str, to: &str) -> Option<String> {
    let from_trimmed = from.trim();
    let to_trimmed = to.trim();
    if from_trimmed.is_empty() || to_trimmed.is_empty() {
        return None;
    }

    let normalized_path = normalize_slashes(path);
    let normalized_from = normalize_slashes(from_trimmed);
    let normalized_to = normalize_slashes(to_trimmed);
    let path_lower = normalized_path.to_lowercase();
    let from_lower = normalized_from.to_lowercase();

    if !path_lower.starts_with(&from_lower) {
        return None;
    }

    let boundary = normalized_path.chars().nth(normalized_from.len());
    if boundary.is_some() && boundary != Some('/') {
        return None;
    }

    let remainder = &normalized_path[normalized_from.len()..];
    Some(format!("{}{}", normalized_to.trim_end_matches('/'), remainder))
}

fn append_log_line(path: &Path, line: &str) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(map_log_directory_error)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(map_log_directory_error)?;
    writeln!(file, "{line}").map_err(map_log_directory_error)?;
    Ok(())
}

fn read_log_file(path: &Path) -> AppResult<String> {
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(AppError::from)
}

fn task_log_path(paths: &StoragePaths, task_id: &str) -> PathBuf {
    paths.logs_dir.join(format!("{task_id}.log"))
}

fn repository_log_path(paths: &StoragePaths, repo_id: &str) -> PathBuf {
    paths.logs_dir.join(format!("repo-{repo_id}.log"))
}

fn copy_file_if_exists(source: &Path, destination: &Path) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }

    let Some(parent) = destination.parent() else {
        return Err(AppError::internal("备份路径无父级目录"));
    };
    fs::create_dir_all(parent)?;
    fs::copy(source, destination)?;
    Ok(())
}

fn copy_directory_if_exists(source: &Path, destination: &Path) -> AppResult<()> {
    if !source.exists() {
        return Ok(());
    }
    if source.is_file() {
        return copy_file_if_exists(source, destination);
    }

    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory_if_exists(&source_path, &destination_path)?;
        } else {
            copy_file_if_exists(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn save_text_file(path: &Path, value: &str) -> AppResult<()> {

    let Some(parent) = path.parent() else {
        return Err(AppError::internal("文本文件路径无父级目录"));
    };

    fs::create_dir_all(parent)?;
    let tmp_path = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(value.as_bytes())?;
    file.flush()?;
    drop(file);

    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn load_json_or_default<T>(path: &Path) -> AppResult<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let contents = fs::read_to_string(path)?;
    if contents.trim().is_empty() {
        return Ok(T::default());
    }

    serde_json::from_str::<T>(&contents).map_err(|error| {
        AppError::new(
            "SD-CFG-002",
            NoticeLevel::Fatal,
            "配置文件损坏",
            "配置文件已损坏，无法正常加载。",
        )
        .with_detail(error.to_string())
        .with_action("恢复备份或重置配置")
    })
}

fn save_json<T>(path: &Path, value: &T) -> AppResult<()>
where
    T: Serialize,
{
    let Some(parent) = path.parent() else {
        return Err(AppError::internal("配置文件路径无父级目录"));
    };

    fs::create_dir_all(parent)?;
    let tmp_path = path.with_extension("tmp");
    let content = serde_json::to_string_pretty(value)?;
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(content.as_bytes())?;
    file.flush()?;
    drop(file);

    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(tmp_path, path)?;
    Ok(())
}

fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value.map(|item| item.trim().to_string()).filter(|item| !item.is_empty())
}

fn same_path(left: &str, right: &str) -> bool {
    normalize_slashes(left).to_lowercase() == normalize_slashes(right).to_lowercase()
}

fn path_equals(left: &Path, right: &Path) -> bool {
    normalize_path_for_compare(left) == normalize_path_for_compare(right)
}

fn normalize_path_for_compare(path: &Path) -> String {
    normalize_slashes(&path.to_string_lossy()).to_lowercase()
}

fn normalize_slashes(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn map_config_write_error(error: AppError) -> AppError {
    AppError::new(
        "SD-CFG-003",
        NoticeLevel::Error,
        "配置写入失败",
        "配置保存失败，请检查磁盘空间或目录权限。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("重试保存")
}

fn map_config_directory_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "SD-CFG-004",
        NoticeLevel::Error,
        "配置目录无效",
        "当前配置目录不可用，请重新选择可读写位置。",
    )
    .with_detail(error.to_string())
    .with_action("重新选择目录")
}

fn map_config_directory_change_error(error: AppError) -> AppError {
    AppError::new(
        "SD-CFG-005",
        NoticeLevel::Error,
        "配置目录切换失败",
        "配置目录切换失败，请检查目录权限或磁盘空间。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("重新选择目录")
}

fn map_log_directory_error(error: impl std::fmt::Display) -> AppError {

    AppError::new(
        "SD-LOG-001",
        NoticeLevel::Error,
        "日志目录无效",
        "当前日志目录不可用，请重新选择可读写位置。",
    )
    .with_detail(error.to_string())
    .with_action("重新选择目录")
}

fn map_log_export_error(error: AppError) -> AppError {
    AppError::new(
        "SD-LOG-002",
        NoticeLevel::Error,
        "日志导出失败",
        "日志导出失败，请检查目录权限或磁盘空间。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("更换导出位置")
}

fn map_log_cleanup_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "SD-LOG-003",
        NoticeLevel::Error,
        "日志清理失败",
        "日志清理失败，请检查日志目录权限。",
    )
    .with_detail(error.to_string())
    .with_action("检查日志目录")
}

fn map_migration_export_error(error: AppError) -> AppError {
    AppError::new(
        "SD-MIG-005",
        NoticeLevel::Error,
        "配置导出失败",
        "配置导出失败，请检查目录权限或磁盘空间。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("更换导出位置")
}

fn map_migration_import_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "SD-MIG-001",
        NoticeLevel::Error,
        "导入文件无效",
        "导入失败，文件格式无效或内容不完整。",
    )
    .with_detail(error.to_string())
    .with_action("重新选择文件")
}

  