export type NoticeLevel = "info" | "warning" | "error" | "fatal";

export type SyncItemState =
  | "idle"
  | "checking"
  | "fetching"
  | "comparing"
  | "pulling"
  | "success"
  | "skipped"
  | "failed"
  | "cancelled";

export type RepoTone = "neutral" | "success" | "pending" | "warning" | "danger";

export type RepositoryOwnership = "mine" | "other" | "unassigned";

export type PreferredView = "overview" | "repositories" | "tasks" | "settings";
export type ThemeMode = "system" | "light" | "dark";
export type LanguageMode = "zh-CN" | "en-US";
export type ImportStrategy = "merge" | "overwrite" | "repositoriesOnly" | "settingsOnly";
export type SyncMode = "safe" | "force" | "rebase";



export interface RepositoryStatus {
  repoHealthy: boolean;
  currentBranch: string;
  upstreamConfigured: boolean;
  upstreamName?: string | null;
  hasUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
  untrackedCount: number;
  aheadCount: number;
  behindCount: number;
  syncRequired: boolean;
  detachedHead: boolean;
  inProgressOperation: boolean;
  statusText: string;
  lastCheckedAt?: string | null;
}

export interface RepositoryRecord {
  id: string;
  name: string;
  path: string;
  remoteUrl?: string | null;
  group: string;
  ownership: RepositoryOwnership;
  enabled: boolean;
  note: string;
  lastSyncAt?: string | null;
  lastSyncStatus?: SyncItemState | null;
  lastSyncMessage?: string | null;
  lastErrorMessage?: string | null;
  status: RepositoryStatus;
}

export interface SyncTaskItemResult {
  repoId: string;
  repoName: string;
  repoPath: string;
  state: SyncItemState;
  level: NoticeLevel;
  code?: string | null;
  title: string;
  detail: string;
  action?: string | null;
  technicalDetail?: string | null;
  retryable: boolean;
  durationMs: number;
  finishedAt: string;
}

export interface SyncTaskRecord {
  taskId: string;
  createdAt: string;
  startTime: string;
  endTime?: string | null;
  mode: string;
  running: boolean;
  cancelRequested: boolean;
  cancelled: boolean;
  total: number;
  completed: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  cancelledCount: number;
  targetRepoIds: string[];
  items: SyncTaskItemResult[];
  summaryMessage: string;
  logFile: string;
}


export interface GitEnvironment {
  available: boolean;
  version?: string | null;
  executablePath?: string | null;
  message: string;
  checkedAt: string;
}

export interface AppSettings {
  concurrentLimit: number;
  commandTimeoutSecs: number;
  skipUntrackedFiles: boolean;
  showDebugLogs: boolean;
  logRetentionDays: number;
  logsDirectory?: string | null;
  defaultScanRoot?: string | null;
  ignoredDirectories: string[];
  scanDepth: number;
  defaultView: PreferredView;
  themeMode: ThemeMode;
  languageMode: LanguageMode;
  syncMode?: SyncMode;
}



export interface AppSnapshot {
  gitEnvironment: GitEnvironment;
  settings: AppSettings;
  repositories: RepositoryRecord[];
  tasks: SyncTaskRecord[];
  configDirectory: string;
  logsDirectory: string;
}

export interface LogsDiagnostics {
  directory: string;
  configuredDirectory?: string | null;
  usingCustomDirectory: boolean;
  fallbackActive: boolean;
  fileCount: number;
  totalSizeBytes: number;
  writable: boolean;
}

export interface LogCleanupResult {
  removedFiles: number;
  freedBytes: number;
  directory: string;
}

export interface ConfigExportResult {
  path: string;
  repositoryCount: number;
  taskCount: number;
}

export interface ImportRepoConflict {
  path: string;
  existingName: string;
  incomingName: string;
  existingGroup: string;
  incomingGroup: string;
}

export interface ConfigImportPreview {
  source: string;
  version: number;
  exportedAt: string;
  repositoryCount: number;
  taskCount: number;
  invalidRepoPaths: string[];
  repoConflicts: ImportRepoConflict[];
  warnings: AppErrorResponse[];
  settingsChanges: string[];
  logsDirectoryStatus: "empty" | "ok" | "invalid";
  logsDirectory?: string | null;
}


export interface PathPrefixReplacement {
  from: string;
  to: string;
}

export interface ConfigImportRequest {
  source: string;
  strategy: ImportStrategy;
  skipConflicts: boolean;
  pathPrefixReplacements: PathPrefixReplacement[];
}

export interface ConfigImportResult {
  repositoryCount: number;
  taskCount: number;
  invalidRepoPaths: string[];
  skippedLogsDirectory?: string | null;
  backupDirectory: string;
  conflictCount: number;
  replacedPathCount: number;
  warnings: AppErrorResponse[];
  appliedStrategy: ImportStrategy;
}


export interface ScannedRepository {
  path: string;
  name: string;
  currentBranch: string;
  remoteUrl?: string | null;
  group: string;
  ownership: RepositoryOwnership;
  status: string;
  selected: boolean;
}

export interface RepositoryDraftInput {
  path: string;
  name?: string | null;
  group?: string | null;
  ownership: RepositoryOwnership;
  note?: string | null;
}

export interface RepositoryUpdateInput {
  id: string;
  name: string;
  path: string;
  group: string;
  ownership: RepositoryOwnership;
  note: string;
  enabled: boolean;
}


export interface ScanRequest {
  rootPath: string;
  maxDepth?: number | null;
}

export interface CloneRepositoryRequest {
  remoteUrl: string;
  destinationParent: string;
  directoryName?: string | null;
  group?: string | null;
  ownership: RepositoryOwnership;
  note?: string | null;
}

export interface SyncProgressEvent {
  task: SyncTaskRecord;
  currentRepoId?: string | null;
  currentRepoName?: string | null;
}

export interface AppErrorResponse {
  code: string;
  level: NoticeLevel;
  title: string;
  message: string;
  action?: string | null;
  detail?: string | null;
  repoId?: string | null;
  taskId?: string | null;
  retryable: boolean;
}
