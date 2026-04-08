import { invoke } from "@tauri-apps/api/tauri";
import type {
  AppErrorResponse,
  AppSettings,
  AppSnapshot,
  CloneRepositoryRequest,
  ConfigExportResult,
  ConfigImportPreview,
  ConfigImportRequest,
  ConfigImportResult,
  LogCleanupResult,
  LogsDiagnostics,
  RepositoryDraftInput,
  RepositoryRecord,
  RepositoryUpdateInput,
  SyncTaskRecord
} from "./types";

export function toAppError(error: unknown): AppErrorResponse {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return error as AppErrorResponse;
  }

  return {
    code: "SD-INT-001",
    level: "error",
    title: "未分类内部错误",
    message: typeof error === "string" ? error : "发生未预期问题，请查看日志或重试。",
    retryable: false
  };
}

export const api = {
  getAppSnapshot: () => invoke<AppSnapshot>("get_app_snapshot"),
  pickDirectory: () => invoke<string | null>("pick_directory"),
  pickFile: () => invoke<string | null>("pick_file"),
  pickSaveFile: (defaultName?: string) =>
    invoke<string | null>("pick_save_file", { defaultName: defaultName?.trim() ? defaultName : null }),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  setConfigDirectory: (directory?: string | null) =>
    invoke<string>("set_config_directory", { directory: directory?.trim() ? directory : null }),
  getLogsDiagnostics: () => invoke<LogsDiagnostics>("get_logs_diagnostics"),

  cleanupLogs: () => invoke<LogCleanupResult>("cleanup_logs"),
  getRepositoryLog: (repoId: string) => invoke<string>("get_repository_log", { repoId }),
  getAllRepositoryLogs: () => invoke<string>("get_all_repository_logs"),
  exportTaskLog: (taskId: string, destination: string) =>
    invoke<string>("export_task_log", { taskId, destination }),
  exportRepositoryLog: (repoId: string, destination: string) =>
    invoke<string>("export_repository_log", { repoId, destination }),
  exportAllRepositoryLogs: (destination: string) =>
    invoke<string>("export_all_repository_logs", { destination }),
  exportConfig: (destination: string) => invoke<ConfigExportResult>("export_config", { destination }),
  previewConfigImport: (source: string) => invoke<ConfigImportPreview>("preview_config_import", { source }),
  importConfig: (request: ConfigImportRequest) => invoke<ConfigImportResult>("import_config", { request }),
  addRepository: (input: RepositoryDraftInput) => invoke<RepositoryRecord>("add_repository", { input }),
  updateRepository: (input: RepositoryUpdateInput) =>
    invoke<RepositoryRecord>("update_repository", { input }),
  removeRepository: (repoId: string) => invoke<void>("remove_repository", { repoId }),
  refreshRepositories: (repoIds?: string[]) =>
    invoke<RepositoryRecord[]>("refresh_repositories", { repoIds: repoIds?.length ? repoIds : null }),
  refreshRepositoriesInBackground: (repoIds?: string[]) =>
    invoke<SyncTaskRecord>("refresh_repositories_command", { repoIds: repoIds?.length ? repoIds : null }),
  syncRepositories: (repoIds?: string[], group?: string) =>
    invoke<SyncTaskRecord>("sync_repositories_command", {
      repoIds: repoIds?.length ? repoIds : null,
      group: group?.trim() ? group : null
    }),
  forceSyncRepositories: (repoIds?: string[], group?: string) =>
    invoke<SyncTaskRecord>("force_sync_repositories_command", {
      repoIds: repoIds?.length ? repoIds : null,
      group: group?.trim() ? group : null
    }),
  cancelSyncTask: () => invoke<string | null>("cancel_sync_task_command"),
  getTaskLog: (taskId: string) => invoke<string>("get_task_log", { taskId }),

  openExternal: (target: string) => invoke<void>("open_external", { target }),
  cloneRepository: (request: CloneRepositoryRequest) =>
    invoke<RepositoryRecord>("clone_repository_command", { request })
};
