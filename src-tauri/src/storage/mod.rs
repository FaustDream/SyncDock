//! Storage module - handles all persistent storage operations
//!
//! This module is organized into the following submodules:
//! - `paths`: Storage paths management
//! - `helpers`: Common helper functions
//! - `settings`: Settings storage operations
//! - `repositories`: Repository storage operations
//! - `tasks`: Task storage operations
//! - `logs`: Log storage operations
//! - `import_export`: Configuration import and export

mod paths;
mod helpers;
mod settings;
mod repositories;
mod tasks;
mod logs;
mod import_export;

// Re-export public API
pub use settings::{load_settings, save_settings, set_config_directory, ensure_storage};
pub use repositories::{load_repositories, save_repositories, sort_repositories};
pub use tasks::{load_tasks, save_tasks, sort_tasks};
pub use logs::{
    append_task_log, read_task_log, export_task_log,
    append_repository_log, read_repository_log, read_all_repository_logs, export_repository_log, export_all_repository_logs,
    get_logs_diagnostics, cleanup_logs,
};
pub use import_export::{export_config, preview_config_import, import_config};
