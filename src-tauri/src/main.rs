#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod errors;
mod git;
mod models;
mod storage;
mod sync;

use std::path::Path;

use tauri::{api::dialog::blocking::FileDialogBuilder, AppHandle, State};
use uuid::Uuid;

use crate::{
    errors::{AppError, AppResult},
    git::{detect_git_environment, inspect_repository, scan_repositories as scan_local_repositories, clone_repository},
    models::{
        AppSettings, AppSnapshot, CloneRepositoryRequest, ConfigExportResult,
        ConfigImportPreview, ConfigImportRequest, ConfigImportResult, LogCleanupResult,
        LogsDiagnostics, NoticeLevel, RepositoryDraftInput, RepositoryRecord,
        RepositoryUpdateInput, ScanRequest, ScannedRepository, SyncTaskRecord,
    },
    sync::SyncRuntimeState,
};

#[tauri::command]
fn get_app_snapshot(app: AppHandle) -> AppResult<AppSnapshot> {
    let paths = storage::ensure_storage(&app)?;
    let settings = storage::load_settings(&app)?;
    let mut repositories = storage::load_repositories(&app)?;
    let mut tasks = storage::load_tasks(&app).map_err(map_task_history_load_error)?;
    storage::sort_repositories(&mut repositories);
    storage::sort_tasks(&mut tasks);

    Ok(AppSnapshot {
        git_environment: detect_git_environment(),
        settings,
        repositories,
        tasks,
        config_directory: paths.root.to_string_lossy().to_string(),
        logs_directory: paths.logs_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn pick_directory() -> Option<String> {
    FileDialogBuilder::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_file() -> Option<String> {
    FileDialogBuilder::new()
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save_file(default_name: Option<String>) -> Option<String> {
    let builder = default_name
        .filter(|value| !value.trim().is_empty())
        .map(|value| FileDialogBuilder::new().set_file_name(&value))
        .unwrap_or_else(FileDialogBuilder::new);

    builder
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: AppSettings) -> AppResult<AppSettings> {
    storage::save_settings(&app, &settings)?;
    storage::load_settings(&app)
}

#[tauri::command]
fn set_config_directory(app: AppHandle, directory: Option<String>) -> AppResult<String> {
    let paths = storage::set_config_directory(&app, directory.as_deref())?;
    Ok(paths.root.to_string_lossy().to_string())
}

#[tauri::command]
fn get_logs_diagnostics(app: AppHandle) -> AppResult<LogsDiagnostics> {
    storage::get_logs_diagnostics(&app)
}

#[tauri::command]
fn cleanup_logs(app: AppHandle) -> AppResult<LogCleanupResult> {
    storage::cleanup_logs(&app)
}

#[tauri::command]
fn get_task_log(app: AppHandle, task_id: String) -> AppResult<String> {
    storage::read_task_log(&app, &task_id).map_err(map_log_view_load_error)
}

#[tauri::command]
fn get_repository_log(app: AppHandle, repo_id: String) -> AppResult<String> {
    storage::read_repository_log(&app, &repo_id).map_err(map_log_view_load_error)
}

#[tauri::command]
fn export_task_log(app: AppHandle, task_id: String, destination: String) -> AppResult<String> {
    storage::export_task_log(&app, &task_id, &destination)
}

#[tauri::command]
fn export_repository_log(app: AppHandle, repo_id: String, destination: String) -> AppResult<String> {
    storage::export_repository_log(&app, &repo_id, &destination)
}

#[tauri::command]
fn export_config(app: AppHandle, destination: String) -> AppResult<ConfigExportResult> {
    storage::export_config(&app, &destination)
}

#[tauri::command]
fn preview_config_import(app: AppHandle, source: String) -> AppResult<ConfigImportPreview> {
    storage::preview_config_import(&app, &source)
}

#[tauri::command]
fn import_config(app: AppHandle, request: ConfigImportRequest) -> AppResult<ConfigImportResult> {
    storage::import_config(&app, &request)
}

#[tauri::command]
fn scan_repositories(app: AppHandle, request: ScanRequest) -> AppResult<Vec<ScannedRepository>> {
    let settings = storage::load_settings(&app)?;
    let max_depth = request.max_depth.unwrap_or(settings.scan_depth);
    scan_local_repositories(&request.root_path, max_depth, &settings)
}

#[tauri::command]
fn import_scanned_repositories(
    app: AppHandle,
    repositories: Vec<ScannedRepository>,
) -> AppResult<Vec<RepositoryRecord>> {
    let settings = storage::load_settings(&app)?;
    let mut existing = storage::load_repositories(&app)?;
    let mut imported = Vec::new();

    for scanned in repositories.into_iter().filter(|repo| repo.selected) {
        let input = RepositoryDraftInput {
            path: scanned.path,
            name: Some(scanned.name),
            group: Some(scanned.group),
            ownership: scanned.ownership,
            note: None,
        };
        if let Ok(record) = create_repository_record(&settings, &existing, input) {
            existing.push(record.clone());
            imported.push(record);
        }
    }

    storage::sort_repositories(&mut existing);
    storage::save_repositories(&app, &existing)?;
    Ok(imported)
}

#[tauri::command]
fn add_repository(app: AppHandle, input: RepositoryDraftInput) -> AppResult<RepositoryRecord> {
    let settings = storage::load_settings(&app)?;
    let mut existing = storage::load_repositories(&app)?;
    let record = create_repository_record(&settings, &existing, input)?;
    existing.push(record.clone());
    storage::sort_repositories(&mut existing);
    storage::save_repositories(&app, &existing)?;
    Ok(record)
}

#[tauri::command]
fn update_repository(app: AppHandle, input: RepositoryUpdateInput) -> AppResult<RepositoryRecord> {
    let settings = storage::load_settings(&app)?;
    let mut repositories = storage::load_repositories(&app)?;
    let inspection = inspect_repository(&input.path, &settings)?;

    if repositories.iter().any(|repo| repo.id != input.id && repo.path.eq_ignore_ascii_case(&inspection.normalized_path)) {
        return Err(
            AppError::new(
                "SD-REPO-008",
                NoticeLevel::Warning,
                "仓库重复导入",
                "该仓库已存在于列表中，未重复保存。",
            )
            .with_action("选择其他仓库目录"),
        );
    }

    let repo = repositories
        .iter_mut()
        .find(|repo| repo.id == input.id)
        .ok_or_else(|| {
            AppError::new(
                "SD-REPO-002",
                NoticeLevel::Error,
                "仓库已损坏",
                "未找到需要更新的仓库记录。",
            )
        })?;

    let normalized_path = inspection.normalized_path;
    let trimmed_name = input.name.trim();
    repo.name = if trimmed_name.is_empty() {
        derive_repo_name(&normalized_path)
    } else {
        trimmed_name.to_string()
    };

    repo.path = normalized_path;
    repo.group = if input.group.trim().is_empty() {
        "未分组".into()
    } else {
        input.group.trim().to_string()
    };
    repo.note = input.note.trim().to_string();
    repo.ownership = input.ownership;
    repo.enabled = input.enabled;
    repo.remote_url = inspection.remote_url;
    repo.status = inspection.status;
    repo.last_error_message = None;

    let updated = repo.clone();
    storage::sort_repositories(&mut repositories);
    storage::save_repositories(&app, &repositories)?;
    Ok(updated)
}

#[tauri::command]
fn remove_repository(app: AppHandle, repo_id: String) -> AppResult<()> {
    let mut repositories = storage::load_repositories(&app)?;
    repositories.retain(|repo| repo.id != repo_id);
    storage::save_repositories(&app, &repositories)
}

#[tauri::command]
fn refresh_repositories(app: AppHandle, repo_ids: Option<Vec<String>>) -> AppResult<Vec<RepositoryRecord>> {
    let settings = storage::load_settings(&app)?;
    let mut repositories = storage::load_repositories(&app)?;
    let targets = repo_ids.unwrap_or_default();

    for repo in repositories.iter_mut() {
        if !targets.is_empty() && !targets.contains(&repo.id) {
            continue;
        }

        match inspect_repository(&repo.path, &settings) {
            Ok(inspection) => {
                repo.path = inspection.normalized_path;
                repo.remote_url = inspection.remote_url;
                repo.status = inspection.status;
                repo.last_error_message = None;
            }
            Err(error) => {
                repo.status.status_text = error.message.clone();
                repo.status.repo_healthy = false;
                repo.status.last_checked_at = Some(chrono::Utc::now().to_rfc3339());
                repo.last_error_message = Some(error.message);
            }
        }
    }

    storage::sort_repositories(&mut repositories);
    storage::save_repositories(&app, &repositories)?;
    Ok(repositories)
}

#[tauri::command]
fn sync_repositories_command(
    app: AppHandle,
    runtime: State<SyncRuntimeState>,
    repo_ids: Option<Vec<String>>,
    group: Option<String>,
) -> AppResult<SyncTaskRecord> {
    sync::sync_repositories(&app, runtime.inner(), repo_ids, group)
}

#[tauri::command]
fn force_sync_repositories_command(
    app: AppHandle,
    runtime: State<SyncRuntimeState>,
    repo_ids: Option<Vec<String>>,
    group: Option<String>,
) -> AppResult<SyncTaskRecord> {
    sync::force_sync_repositories(&app, runtime.inner(), repo_ids, group)
}

#[tauri::command]
fn cancel_sync_task_command(app: AppHandle, runtime: State<SyncRuntimeState>) -> AppResult<Option<String>> {
    sync::cancel_sync_task(&app, runtime.inner())
}

#[tauri::command]
fn open_external(target: String) -> AppResult<()> {
    open::that_detached(target).map_err(|error| {
        AppError::new(
            "SD-UI-001",
            NoticeLevel::Error,
            "页面数据加载失败",
            "无法打开目标路径或链接，请检查内容是否有效。",
        )
        .with_detail(error.to_string())
    })
}

#[tauri::command]
fn clone_repository_command(
    app: AppHandle,
    request: CloneRepositoryRequest,
) -> AppResult<RepositoryRecord> {
    let settings = storage::load_settings(&app)?;
    let mut existing = storage::load_repositories(&app)?;
    let path = clone_repository(&request, &settings)?;
    let record = create_repository_record(
        &settings,
        &existing,
        RepositoryDraftInput {
            path,
            name: None,
            group: request.group,
            ownership: request.ownership,
            note: request.note,
        },
    )?;
    existing.push(record.clone());
    storage::sort_repositories(&mut existing);
    storage::save_repositories(&app, &existing)?;
    Ok(record)
}

fn create_repository_record(
    settings: &AppSettings,
    existing: &[RepositoryRecord],
    input: RepositoryDraftInput,
) -> AppResult<RepositoryRecord> {
    let inspection = inspect_repository(&input.path, settings)?;
    if existing.iter().any(|repo| repo.path.eq_ignore_ascii_case(&inspection.normalized_path)) {
        return Err(
            AppError::new(
                "SD-REPO-008",
                NoticeLevel::Warning,
                "仓库重复导入",
                "该仓库已存在于列表中，未重复导入。",
            )
            .with_action("无"),
        );
    }

    Ok(RepositoryRecord {
        id: format!("repo_{}", Uuid::new_v4().simple()),
        name: input
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| derive_repo_name(&inspection.normalized_path)),
        path: inspection.normalized_path,
        remote_url: inspection.remote_url,
        group: input
            .group
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "未分组".into()),
        ownership: input.ownership,
        enabled: true,
        note: input.note.unwrap_or_default(),
        last_sync_at: None,
        last_sync_status: None,
        last_sync_message: None,
        last_error_message: None,
        status: inspection.status,
    })
}

fn derive_repo_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn map_task_history_load_error(error: AppError) -> AppError {
    AppError::new(
        "SD-TASK-005",
        NoticeLevel::Error,
        "历史任务加载失败",
        "历史任务加载失败，请刷新后重试。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("刷新后重试")
    .retryable(true)
}

fn map_log_view_load_error(error: AppError) -> AppError {
    AppError::new(
        "SD-UI-004",
        NoticeLevel::Error,
        "日志视图加载失败",
        "日志视图加载失败，请重新打开页面。",
    )
    .with_detail(error.detail.unwrap_or(error.message))
    .with_action("重新打开页面")
    .retryable(true)
}

fn main() {
    tauri::Builder::default()
        .manage(SyncRuntimeState::default())
        .setup(|app| {
            storage::ensure_storage(&app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_snapshot,
            pick_directory,
            pick_file,
            pick_save_file,
            save_settings,
            set_config_directory,
            get_logs_diagnostics,
            cleanup_logs,
            get_task_log,
            get_repository_log,
            export_task_log,
            export_repository_log,
            export_config,
            preview_config_import,
            import_config,
            scan_repositories,
            import_scanned_repositories,
            add_repository,
            update_repository,
            remove_repository,
            refresh_repositories,
            sync_repositories_command,
            force_sync_repositories_command,
            cancel_sync_task_command,
            open_external,
            clone_repository_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running SyncDock");
}
