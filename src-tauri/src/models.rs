use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NoticeLevel {
    Info,
    Warning,
    Error,
    Fatal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineNotice {
    pub code: String,
    pub level: NoticeLevel,
    pub title: String,
    pub message: String,
    pub action: Option<String>,
    pub detail: Option<String>,
    pub repo_id: Option<String>,
    pub task_id: Option<String>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SyncItemState {
    Idle,
    Checking,
    Fetching,
    Comparing,
    Pulling,
    Success,
    Skipped,
    Failed,
    Cancelled,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ImportStrategy {
    Merge,
    Overwrite,
    RepositoriesOnly,
    SettingsOnly,
}

/// Sync mode for repository synchronization
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum SyncMode {
    #[default]
    Safe,
    Force,
    Rebase,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RepositoryOwnership {
    Mine,
    Other,
    Unassigned,
}

impl Default for RepositoryOwnership {
    fn default() -> Self {
        Self::Unassigned
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryStatus {
    pub repo_healthy: bool,
    pub current_branch: String,
    pub upstream_configured: bool,
    pub upstream_name: Option<String>,
    pub has_uncommitted_changes: bool,
    pub has_untracked_files: bool,
    pub untracked_count: usize,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub sync_required: bool,
    pub detached_head: bool,
    pub in_progress_operation: bool,
    pub status_text: String,
    pub last_checked_at: Option<String>,
}

impl Default for RepositoryStatus {
    fn default() -> Self {
        Self {
            repo_healthy: false,
            current_branch: "-".into(),
            upstream_configured: false,
            upstream_name: None,
            has_uncommitted_changes: false,
            has_untracked_files: false,
            untracked_count: 0,
            ahead_count: 0,
            behind_count: 0,
            sync_required: false,
            detached_head: false,
            in_progress_operation: false,
            status_text: "未检测".into(),
            last_checked_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub group: String,
    #[serde(default)]
    pub ownership: RepositoryOwnership,
    pub enabled: bool,
    pub note: String,
    pub last_sync_at: Option<String>,
    pub last_sync_status: Option<SyncItemState>,
    pub last_sync_message: Option<String>,
    pub last_error_message: Option<String>,
    pub status: RepositoryStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTaskItemResult {
    pub repo_id: String,
    pub repo_name: String,
    pub repo_path: String,
    pub state: SyncItemState,
    pub level: NoticeLevel,
    pub code: Option<String>,
    pub title: String,
    pub detail: String,
    pub action: Option<String>,
    pub technical_detail: Option<String>,
    pub retryable: bool,
    pub duration_ms: u128,
    pub finished_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTaskProgressLog {
    pub at: String,
    pub level: NoticeLevel,
    pub phase: String,
    pub message: String,
    pub repo_id: Option<String>,
    pub repo_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTaskRecord {
    pub task_id: String,
    pub created_at: String,
    pub start_time: String,
    pub end_time: Option<String>,
    pub mode: String,
    pub running: bool,
    #[serde(default)]
    pub cancel_requested: bool,
    #[serde(default)]
    pub cancelled: bool,
    pub total: usize,
    pub completed: usize,
    pub success_count: usize,
    pub failed_count: usize,
    pub skipped_count: usize,
    #[serde(default)]
    pub cancelled_count: usize,
    pub target_repo_ids: Vec<String>,
    pub items: Vec<SyncTaskItemResult>,
    #[serde(default)]
    pub progress_logs: Vec<SyncTaskProgressLog>,
    pub summary_message: String,
    pub log_file: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEnvironment {
    pub available: bool,
    pub version: Option<String>,
    pub executable_path: Option<String>,
    pub message: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub concurrent_limit: usize,
    pub command_timeout_secs: u64,
    #[serde(default = "default_auto_retry_transient_failures")]
    pub auto_retry_transient_failures: bool,
    pub skip_untracked_files: bool,
    pub show_debug_logs: bool,
    pub log_retention_days: u32,
    pub logs_directory: Option<String>,
    pub default_view: String,
    pub theme_mode: String,
    pub language_mode: String,
    #[serde(default)]
    pub sync_mode: SyncMode,
}



impl Default for AppSettings {
    fn default() -> Self {
        Self {
            concurrent_limit: 3,
            command_timeout_secs: 45,
            auto_retry_transient_failures: default_auto_retry_transient_failures(),
            skip_untracked_files: false,
            show_debug_logs: true,
            log_retention_days: 30,
            logs_directory: None,
            default_view: "overview".into(),
            theme_mode: "system".into(),
            language_mode: "zh-CN".into(),
            sync_mode: SyncMode::default(),
        }
    }
}

fn default_auto_retry_transient_failures() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub git_environment: GitEnvironment,
    pub settings: AppSettings,
    pub repositories: Vec<RepositoryRecord>,
    pub tasks: Vec<SyncTaskRecord>,
    pub config_directory: String,
    pub logs_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsDiagnostics {
    pub directory: String,
    pub configured_directory: Option<String>,
    pub using_custom_directory: bool,
    pub fallback_active: bool,
    pub file_count: usize,
    pub total_size_bytes: u64,
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogCleanupResult {
    pub removed_files: usize,
    pub freed_bytes: u64,
    pub directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigExportResult {
    pub path: String,
    pub repository_count: usize,
    pub task_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRepoConflict {
    pub path: String,
    pub existing_name: String,
    pub incoming_name: String,
    pub existing_group: String,
    pub incoming_group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImportPreview {
    pub source: String,
    pub version: u32,
    pub exported_at: String,
    pub repository_count: usize,
    pub task_count: usize,
    pub invalid_repo_paths: Vec<String>,
    pub repo_conflicts: Vec<ImportRepoConflict>,
    pub warnings: Vec<InlineNotice>,
    pub settings_changes: Vec<String>,
    pub logs_directory_status: String,
    pub logs_directory: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPrefixReplacement {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImportRequest {
    pub source: String,
    pub strategy: ImportStrategy,
    pub skip_conflicts: bool,
    pub path_prefix_replacements: Vec<PathPrefixReplacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigImportResult {
    pub repository_count: usize,
    pub task_count: usize,
    pub invalid_repo_paths: Vec<String>,
    pub skipped_logs_directory: Option<String>,
    pub backup_directory: String,
    pub conflict_count: usize,
    pub replaced_path_count: usize,
    pub warnings: Vec<InlineNotice>,
    pub applied_strategy: ImportStrategy,
}


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigTransferBundle {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub exported_at: String,
    #[serde(default)]
    pub settings: AppSettings,
    #[serde(default)]
    pub repositories: Vec<RepositoryRecord>,
    #[serde(default)]
    pub tasks: Vec<SyncTaskRecord>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDraftInput {
    pub path: String,
    pub name: Option<String>,
    pub group: Option<String>,
    pub ownership: RepositoryOwnership,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryUpdateInput {
    pub id: String,
    pub name: String,
    pub path: String,
    pub group: String,
    pub ownership: RepositoryOwnership,
    pub note: String,
    pub enabled: bool,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneRepositoryRequest {
    pub remote_url: String,
    pub destination_parent: String,
    pub directory_name: Option<String>,
    pub group: Option<String>,
    pub ownership: RepositoryOwnership,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressEvent {
    pub task: SyncTaskRecord,
    pub current_repo_id: Option<String>,
    pub current_repo_name: Option<String>,
}
