//! Application Context for global state management

import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, toAppError } from "../api";
import type {
  AppSettings,
  AppSnapshot,
  GitEnvironment,
  LogsDiagnostics,
  RepositoryRecord,
  RepositoryUpdateInput,
  SyncProgressEvent,
  SyncTaskRecord,
  CloneRepositoryRequest,
  RepositoryDraftInput,
  ScannedRepository
} from "../types";
import { getRepositoryMeta } from "../utils/repoHelpers";
import { getImportStrategyLabel } from "../utils/importHelpers";
import { formatBytes, formatDateKey } from "../utils/formatters";
import { normalizeLanguageMode, normalizePreferredView, normalizeThemeMode, mergeTasks, sortRepositories, normalizeScannedRepositories, getPathLeafName } from "../utils";

// Context types
export type ViewKey = "overview" | "repositories" | "tasks" | "settings";
export type OverviewTab = "status" | "summary";
export type RepositoryTab = "workspace" | "list" | "logs";
export type SettingsTab = "general" | "sync" | "paths" | "repositories" | "about";
export type TaskTab = "overview" | "history" | "detail" | "repoResults" | "logs";
export type RepoTone = "neutral" | "success" | "pending" | "warning" | "danger";
export type LogLevelFilter = "all" | "warning" | "error";
export type TaskResultFilter = "all" | "failed" | "warning" | "success";

export type NoticeState = {
  type: "success" | "warning" | "error";
  title: string;
  message?: string;
  code?: string;
  detail?: string;
  action?: string;
  retryable?: boolean;
};

export type MainRouteState = { kind: "main"; view: ViewKey };
export type RepoDetailRouteState = { kind: "repo-detail"; repoId: string; originView: ViewKey };
export type RouteState = MainRouteState | RepoDetailRouteState;
export type NavigationMode = "push" | "replace";

// Default values
const defaultSettings: AppSettings = {
  concurrentLimit: 3,
  commandTimeoutSecs: 45,
  skipUntrackedFiles: false,
  showDebugLogs: true,
  logRetentionDays: 30,
  logsDirectory: "",
  defaultScanRoot: "",
  ignoredDirectories: [".git", "node_modules", "target", "dist", "build"],
  scanDepth: 4,
  defaultView: "overview",
  themeMode: "system",
  languageMode: "zh-CN"
};

const defaultGitEnvironment: GitEnvironment = {
  available: false,
  version: "",
  executablePath: "",
  message: "未检测到 Git",
  checkedAt: new Date().toISOString()
};

const defaultLogsDiagnostics: LogsDiagnostics = {
  directory: "",
  configuredDirectory: null,
  usingCustomDirectory: false,
  fallbackActive: false,
  fileCount: 0,
  totalSizeBytes: 0,
  writable: false
};

// Context interface
interface AppContextValue {
  // View state
  view: ViewKey;
  setView: (view: ViewKey) => void;
  overviewTab: OverviewTab;
  setOverviewTab: (tab: OverviewTab) => void;
  overviewStatusFilter: string;
  setOverviewStatusFilter: (filter: string) => void;
  repositoryTab: RepositoryTab;
  setRepositoryTab: (tab: RepositoryTab) => void;
  taskTab: TaskTab;
  setTaskTab: (tab: TaskTab) => void;
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  repositoryGroupTab: string;
  setRepositoryGroupTab: (tab: string) => void;

  // Route state
  repoDetailRoute: RepoDetailRouteState | null;
  repoDetailOpen: boolean;
  activePrimaryView: ViewKey;
  updateRoute: (route: RouteState, mode?: NavigationMode) => void;
  navigateToView: (view: ViewKey, mode?: NavigationMode) => void;
  openRepoDetail: (repoId: string, originView?: ViewKey) => void;
  closeRepoDetail: () => void;

  // Loading state
  loading: boolean;
  busyAction: string | null;

  // Data state
  repositories: RepositoryRecord[];
  tasks: SyncTaskRecord[];
  syncTask: SyncTaskRecord | null;
  currentTaskRepoName: string;
  gitEnvironment: GitEnvironment;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  configDirectory: string;
  logsDirectory: string;
  logsDiagnostics: LogsDiagnostics;
  // Data setters
  setRepositories: (repos: RepositoryRecord[]) => void;
  setTasks: React.Dispatch<React.SetStateAction<SyncTaskRecord[]>>;
  setSyncTask: (task: SyncTaskRecord | null) => void;
  setCurrentTaskRepoName: (name: string) => void;

  // Selection state
  selectedRepoId: string;
  setSelectedRepoId: (id: string) => void;
  selectedTaskId: string;
  setSelectedTaskId: (id: string) => void;
  selectedRepoIds: string[];
  setSelectedRepoIds: (ids: string[]) => void;
  repoForm: RepositoryUpdateInput | null;
  setRepoForm: React.Dispatch<React.SetStateAction<RepositoryUpdateInput | null>>;

  // Log state
  taskLog: string;
  repositoryLog: string;
  repoLogSearch: string;
  setRepoLogSearch: (search: string) => void;
  repoLogLevelFilter: LogLevelFilter;
  setRepoLogLevelFilter: (filter: LogLevelFilter) => void;
  taskLogSearch: string;
  setTaskLogSearch: (search: string) => void;
  taskLogLevelFilter: LogLevelFilter;
  setTaskLogLevelFilter: (filter: LogLevelFilter) => void;

  // Filter state
  search: string;
  setSearch: (search: string) => void;
  statusFilter: string;
  setStatusFilter: (filter: string) => void;
  groupFilter: string;
  setGroupFilter: (filter: string) => void;
  taskSearch: string;
  setTaskSearch: (search: string) => void;
  taskResultFilter: TaskResultFilter;
  setTaskResultFilter: (filter: TaskResultFilter) => void;
  taskDateFilter: string;
  setTaskDateFilter: (filter: string) => void;

  // Notice state
  notice: NoticeState | null;
  setNotice: (notice: NoticeState | null) => void;
  showNotice: (type: "success" | "warning" | "error", text: string) => void;
  showErrorNotice: (parsed: { title: string; message: string; code?: string; detail?: string; action?: string; retryable?: boolean }) => void;

  // Modal state
  scanModalOpen: boolean;
  setScanModalOpen: (open: boolean) => void;
  addModalOpen: boolean;
  setAddModalOpen: (open: boolean) => void;
  cloneModalOpen: boolean;
  setCloneModalOpen: (open: boolean) => void;
  taskDetailModalOpen: boolean;
  setTaskDetailModalOpen: (open: boolean) => void;
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;

  // Draft state
  draftRepo: RepositoryDraftInput;
  setDraftRepo: (draft: RepositoryDraftInput) => void;
  cloneDraft: CloneRepositoryRequest;
  setCloneDraft: (draft: CloneRepositoryRequest) => void;
  scanRootPath: string;
  setScanRootPath: (path: string) => void;
  scanDepth: number;
  setScanDepth: (depth: number) => void;
  scanResults: ScannedRepository[];
  setScanResults: (results: ScannedRepository[]) => void;

  // Import state
  importSourcePath: string;
  setImportSourcePath: (path: string) => void;
  importPreview: any;
  setImportPreview: (preview: any) => void;
  importResult: any;
  setImportResult: (result: any) => void;
  importStrategy: string;
  setImportStrategy: (strategy: string) => void;
  importSkipConflicts: boolean;
  setImportSkipConflicts: (skip: boolean) => void;
  importPathReplacements: Array<{ from: string; to: string }>;
  setImportPathReplacements: React.Dispatch<React.SetStateAction<Array<{ from: string; to: string }>>>;

  // Computed values
  groups: string[];
  languageMode: "zh-CN" | "en-US";
  activeTask: SyncTaskRecord | null;
  selectedRepo: RepositoryRecord | null;
  selectedTask: SyncTaskRecord | null;
  pendingCount: number;
  successCount: number;
  failedCount: number;
  warningCount: number;
  enabledCount: number;
  syncProgress: number;
  latestTask: SyncTaskRecord | null;

  // Actions
  refreshWorkspaceState: (applyPreferredView?: boolean) => Promise<void>;
  loadSnapshot: () => Promise<void>;
  handleRefresh: (repoIds?: string[]) => Promise<void>;
  handleSync: (repoIds?: string[], group?: string) => Promise<void>;
  handleForceSync: (repoIds?: string[], group?: string) => Promise<void>;
  handleCancelTask: (taskId?: string) => Promise<void>;
  handleSaveSettings: () => Promise<void>;
  handleCleanupLogs: () => Promise<void>;
  handleExportTaskLog: () => Promise<void>;
  handleExportRepositoryLog: () => Promise<void>;
  handleExportConfig: () => Promise<void>;
  handleSelectImportConfig: () => Promise<void>;
  handleImportConfig: () => Promise<void>;
  handleScanRepositories: () => Promise<void>;
  handleImportScannedRepositories: () => Promise<void>;
  handleAddRepository: () => Promise<void>;
  handleCloneRepository: () => Promise<void>;
  handleSaveRepository: () => Promise<void>;
  handleRemoveRepository: () => Promise<void>;
  pickFolder: (setter: (value: string) => void) => Promise<void>;
  copyText: (value: string, successText: string) => Promise<void>;
  toggleRepoSelection: (repoId: string) => void;
  toggleSelectAllVisible: () => void;
  updateScanResult: (index: number, updater: (repo: ScannedRepository) => ScannedRepository) => void;
  handleChangeConfigDirectory: () => Promise<void>;
  handleResetConfigDirectory: () => Promise<void>;
  handleResetLogsDirectory: () => void;
  closeImportModal: () => void;
  openTaskDetail: (taskId: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within AppProvider");
  }
  return context;
}

// Route helpers
function buildRoutePath(route: RouteState): string {
  return route.kind === "repo-detail"
    ? `/repo/${encodeURIComponent(route.repoId)}`
    : "/";
}

function readRouteStateFromLocation(): RouteState | null {
  const pathname = decodeURIComponent(window.location.pathname);
  const routeMatch = pathname.match(/^\/repo\/([^/]+)$/);
  if (routeMatch) {
    const state = parseRouteState(window.history.state);
    return {
      kind: "repo-detail",
      repoId: routeMatch[1],
      originView:
        state?.kind === "repo-detail" ? state.originView : "repositories"
    };
  }
  return parseRouteState(window.history.state);
}

function parseRouteState(value: unknown): RouteState | null {
  if (!value || typeof value !== "object") return null;
  const kind = "kind" in value ? value.kind : null;
  if (kind === "repo-detail") {
    const repoId = "repoId" in value ? value.repoId : null;
    const originView = parseViewKey("originView" in value ? value.originView : null);
    if (typeof repoId === "string" && repoId.trim() && originView) {
      return { kind, repoId, originView };
    }
    return null;
  }
  if (kind === "main") {
    const view = parseViewKey("view" in value ? value.view : null);
    return view ? { kind, view } : null;
  }
  return null;
}

function parseViewKey(value: unknown): ViewKey | null {
  return value === "overview" ||
    value === "repositories" ||
    value === "tasks" ||
    value === "settings"
    ? value
    : null;
}

function getInitialView(): ViewKey {
  const route = readRouteStateFromLocation();
  return route?.kind === "main" ? route.view : "repositories";
}

function getInitialRepoDetailRoute(): RepoDetailRouteState | null {
  const route = readRouteStateFromLocation();
  return route?.kind === "repo-detail" ? route : null;
}

// Provider component
export function AppProvider({ children }: { children: ReactNode }) {
  // View state
  const [view, setView] = useState<ViewKey>(() => getInitialView());
  const [overviewTab, setOverviewTab] = useState<OverviewTab>("status");
  const [overviewStatusFilter, setOverviewStatusFilter] = useState("all");
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>("workspace");
  const [taskTab, setTaskTab] = useState<TaskTab>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [repositoryGroupTab, setRepositoryGroupTab] = useState("all");

  // Route state
  const [repoDetailRoute, setRepoDetailRoute] = useState<RepoDetailRouteState | null>(() => getInitialRepoDetailRoute());

  // Loading state
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Data state
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [tasks, setTasks] = useState<SyncTaskRecord[]>([]);
  const [syncTask, setSyncTask] = useState<SyncTaskRecord | null>(null);
  const [currentTaskRepoName, setCurrentTaskRepoName] = useState("");
  const [gitEnvironment, setGitEnvironment] = useState<GitEnvironment>(defaultGitEnvironment);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [configDirectory, setConfigDirectory] = useState("");
  const [logsDirectory, setLogsDirectory] = useState("");
  const [logsDiagnostics, setLogsDiagnostics] = useState<LogsDiagnostics>(defaultLogsDiagnostics);

  // Selection state
  const [selectedRepoId, setSelectedRepoId] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [repoForm, setRepoForm] = useState<RepositoryUpdateInput | null>(null);

  // Log state
  const [taskLog, setTaskLog] = useState("");
  const [repositoryLog, setRepositoryLog] = useState("");
  const [repoLogSearch, setRepoLogSearch] = useState("");
  const [repoLogLevelFilter, setRepoLogLevelFilter] = useState<LogLevelFilter>("all");
  const [taskLogSearch, setTaskLogSearch] = useState("");
  const [taskLogLevelFilter, setTaskLogLevelFilter] = useState<LogLevelFilter>("all");

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskResultFilter, setTaskResultFilter] = useState<TaskResultFilter>("all");
  const [taskDateFilter, setTaskDateFilter] = useState("");

  // Notice state
  const [notice, setNotice] = useState<NoticeState | null>(null);

  // Modal state
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [taskDetailModalOpen, setTaskDetailModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Draft state
  const [draftRepo, setDraftRepo] = useState<RepositoryDraftInput>({
    path: "", name: "", group: "未分组", note: ""
  });
  const [cloneDraft, setCloneDraft] = useState<CloneRepositoryRequest>({
    remoteUrl: "", destinationParent: "", directoryName: "", group: "未分组", note: ""
  });
  const [scanRootPath, setScanRootPath] = useState("");
  const [scanDepth, setScanDepth] = useState(4);
  const [scanResults, setScanResults] = useState<ScannedRepository[]>([]);

  // Import state
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [importStrategy, setImportStrategy] = useState("merge");
  const [importSkipConflicts, setImportSkipConflicts] = useState(true);
  const [importPathReplacements, setImportPathReplacements] = useState<Array<{ from: string; to: string }>>([{ from: "", to: "" }]);

  // Computed values
  const repoDetailOpen = Boolean(repoDetailRoute);
  const activePrimaryView = repoDetailOpen ? "repositories" : view;
  const languageMode = normalizeLanguageMode(settings.languageMode);

  const groups = useMemo(() => {
    const groupNames = Array.from(new Set(repositories.map((repo) => repo.group).filter(Boolean)));
    // 按分组中最严重的问题状态排序
    const tonePriority: Record<string, number> = { danger: 0, warning: 1, pending: 2, success: 3, neutral: 4 };
    const getGroupPriority = (groupName: string) => {
      const groupRepos = repositories.filter((repo) => repo.group === groupName);
      let minPriority = 4;
      for (const repo of groupRepos) {
        const meta = getRepositoryMeta(repo, settings);
        const priority = tonePriority[meta.tone] ?? 4;
        if (priority < minPriority) minPriority = priority;
      }
      return minPriority;
    };
    return groupNames.sort((a, b) => {
      const priorityA = getGroupPriority(a);
      const priorityB = getGroupPriority(b);
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.localeCompare(b, "zh-CN");
    });
  }, [repositories, settings]);

  const activeTask = syncTask?.running ? syncTask : tasks.find((task) => task.running) ?? null;
  const selectedRepo = repositories.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedTask = useMemo(() => {
    return tasks.find((task) => task.taskId === selectedTaskId) ??
      (syncTask?.taskId === selectedTaskId ? syncTask : null) ??
      tasks[0] ?? syncTask;
  }, [tasks, selectedTaskId, syncTask]);

  const pendingCount = repositories.filter((repo) => repo.status.syncRequired).length;
  const successCount = repositories.filter((repo) => {
    const meta = getRepositoryMeta(repo, settings);
    return meta.tone === "success";
  }).length;
  const failedCount = repositories.filter((repo) => {
    const meta = getRepositoryMeta(repo, settings);
    return meta.tone === "danger";
  }).length;
  const warningCount = repositories.filter((repo) => {
    const meta = getRepositoryMeta(repo, settings);
    return meta.tone === "warning";
  }).length;
  const enabledCount = repositories.filter((repo) => repo.enabled).length;
  const syncProgress = activeTask && activeTask.total > 0 ? (activeTask.completed / activeTask.total) * 100 : 0;
  const latestTask = tasks[0] ?? activeTask;

  // Route functions
  const updateRoute = useCallback((route: RouteState, mode: NavigationMode = "push") => {
    const method = mode === "replace" ? "replaceState" : "pushState";
    if (route.kind === "repo-detail") {
      setRepoDetailRoute(route);
      setSelectedRepoId(route.repoId);
      setView("repositories");
    } else {
      setRepoDetailRoute(null);
      setView(route.view);
    }
    window.history[method](route, "", buildRoutePath(route));
  }, []);

  const navigateToView = useCallback((nextView: ViewKey, mode: NavigationMode = "push") => {
    if (!repoDetailOpen && view === nextView) {
      if (mode === "replace") {
        window.history.replaceState({ kind: "main", view: nextView } satisfies MainRouteState, "", "/");
      }
      return;
    }
    updateRoute({ kind: "main", view: nextView }, mode);
  }, [repoDetailOpen, view, updateRoute]);

  const openRepoDetail = useCallback((repoId: string, originView: ViewKey = activePrimaryView) => {
    updateRoute({ kind: "repo-detail", repoId, originView }, "push");
  }, [activePrimaryView, updateRoute]);

  const closeRepoDetail = useCallback(() => {
    navigateToView(repoDetailRoute?.originView ?? "repositories", "replace");
  }, [repoDetailRoute, navigateToView]);

  // Notice functions
  const showNotice = useCallback((type: "success" | "warning" | "error", text: string) => {
    setNotice({ type, title: text });
  }, []);

  const showErrorNotice = useCallback((parsed: { title: string; message: string; code?: string | null; detail?: string | null; action?: string | null; retryable?: boolean }) => {
    const type = parsed.retryable ? "warning" : "error";
    setNotice({
      type,
      title: parsed.title,
      message: parsed.message,
      code: parsed.code ?? undefined,
      detail: parsed.detail ?? undefined,
      action: parsed.action ?? undefined,
      retryable: parsed.retryable
    });
  }, []);

  const handleError = useCallback((error: unknown) => {
    showErrorNotice(toAppError(error));
  }, [showErrorNotice]);

  // Data functions
  const applySnapshot = useCallback((snapshot: AppSnapshot, applyPreferredView = false) => {
    setRepositories(snapshot.repositories);
    setTasks(snapshot.tasks);
    setGitEnvironment(snapshot.gitEnvironment);
    setSettings(snapshot.settings);
    setConfigDirectory(snapshot.configDirectory);
    setLogsDirectory(snapshot.logsDirectory);
    setScanRootPath(snapshot.settings.defaultScanRoot ?? "");
    setScanDepth(snapshot.settings.scanDepth);

    if (applyPreferredView && !repoDetailOpen) {
      const nextView = normalizePreferredView(snapshot.settings.defaultView);
      setView(nextView);
      window.history.replaceState({ kind: "main", view: nextView } satisfies MainRouteState, "", "/");
    }

    setSelectedRepoId((current) => {
      if (current && snapshot.repositories.some((repo) => repo.id === current)) {
        return current;
      }
      return "";
    });

    setSelectedTaskId((current) => {
      if (current && snapshot.tasks.some((task) => task.taskId === current)) {
        return current;
      }
      return snapshot.tasks[0]?.taskId ?? "";
    });

    setSelectedRepoIds((current) => current.filter((id) => snapshot.repositories.some((repo) => repo.id === id)));
  }, [repoDetailOpen]);

  const refreshWorkspaceState = useCallback(async (applyPreferredView = false) => {
    const [snapshot, diagnostics] = await Promise.all([api.getAppSnapshot(), api.getLogsDiagnostics()]);
    applySnapshot(snapshot, applyPreferredView);
    setLogsDiagnostics(diagnostics);
  }, [applySnapshot]);

  const loadSnapshot = useCallback(async () => {
    try {
      setLoading(true);
      await refreshWorkspaceState(true);
    } finally {
      setLoading(false);
    }
  }, [refreshWorkspaceState]);

  // Action helpers
  const runAction = useCallback(async (actionName: string, action: () => Promise<void>) => {
    try {
      setBusyAction(actionName);
      await action();
    } finally {
      setBusyAction(null);
    }
  }, []);

  const pickFolder = useCallback(async (setter: (value: string) => void) => {
    try {
      const path = await api.pickDirectory();
      if (path) setter(path);
    } catch (error) {
      handleError(error);
    }
  }, [handleError]);

  const copyText = useCallback(async (value: string, successText: string) => {
    if (!value.trim()) {
      showNotice("warning", "当前没有可复制的内容");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      showNotice("success", successText);
    } catch {
      showNotice("error", "复制失败，请检查系统剪贴板权限");
    }
  }, [showNotice]);

  // Main actions
  const handleRefresh = useCallback(async (repoIds?: string[]) => {
    await runAction("refresh", async () => {
      const refreshed = await api.refreshRepositories(repoIds);
      setRepositories(refreshed);
      showNotice("success", "状态已刷新");
    }).catch(handleError);
  }, [runAction, handleError, showNotice]);

  const handleSync = useCallback(async (repoIds?: string[], group?: string) => {
    await runAction("sync", async () => {
      showNotice("success", "同步任务已启动");
      const task = await api.syncRepositories(repoIds, group);
      setSyncTask(task);
      setTasks((current) => mergeTasks(current, task));
      setSelectedTaskId(task.taskId);
      navigateToView("tasks");
      setTaskTab("overview");
      await refreshWorkspaceState(false);
      if (!task.running) showNotice("success", task.summaryMessage);
    }).catch(handleError);
  }, [runAction, showNotice, navigateToView, refreshWorkspaceState, handleError]);

  const handleForceSync = useCallback(async (repoIds?: string[], group?: string) => {
    await runAction("sync", async () => {
      showNotice("warning", "强制同步任务已启动，本地更改将被覆盖");
      const task = await api.forceSyncRepositories(repoIds, group);
      setSyncTask(task);
      setTasks((current) => mergeTasks(current, task));
      setSelectedTaskId(task.taskId);
      navigateToView("tasks");
      setTaskTab("overview");
      await refreshWorkspaceState(false);
      if (!task.running) showNotice("success", task.summaryMessage);
    }).catch(handleError);
  }, [runAction, showNotice, navigateToView, refreshWorkspaceState, handleError]);

  const handleCancelTask = useCallback(async (taskId?: string) => {
    const targetTask =
      (taskId ? tasks.find((task) => task.taskId === taskId) : null) ??
      (syncTask?.taskId === taskId ? syncTask : null) ??
      activeTask;

    if (!targetTask?.running) {
      showNotice("warning", "当前没有运行中的任务");
      return;
    }
    if (activeTask && targetTask.taskId !== activeTask.taskId) {
      showNotice("warning", "仅支持取消当前正在运行的任务");
      return;
    }

    await runAction("cancel-task", async () => {
      const cancelledTaskId = await api.cancelSyncTask();
      if (!cancelledTaskId) {
        showNotice("warning", "当前没有运行中的任务");
        return;
      }
      setSelectedTaskId(cancelledTaskId);
      setSyncTask((current) =>
        current?.taskId === cancelledTaskId ? { ...current, cancelRequested: true } : current
      );
      setTasks((current) =>
        current.map((task) => (task.taskId === cancelledTaskId ? { ...task, cancelRequested: true } : task))
      );
      showNotice("warning", "已请求取消当前同步任务，正在等待正在执行的仓库停止");
    }).catch(handleError);
  }, [tasks, syncTask, activeTask, runAction, showNotice, handleError]);

  const handleSaveSettings = useCallback(async () => {
    await runAction("settings", async () => {
      const nextSettings: AppSettings = {
        ...settings,
        logsDirectory: settings.logsDirectory?.trim() || null,
        defaultScanRoot: settings.defaultScanRoot?.trim() || null,
        ignoredDirectories: settings.ignoredDirectories.filter(Boolean).map((item) => item.trim()).filter(Boolean),
        defaultView: normalizePreferredView(settings.defaultView),
        themeMode: normalizeThemeMode(settings.themeMode),
        languageMode: normalizeLanguageMode(settings.languageMode)
      };
      const saved = await api.saveSettings(nextSettings);
      setSettings(saved);
      await refreshWorkspaceState(false);
      showNotice("success", "设置已保存");
    }).catch(handleError);
  }, [settings, runAction, refreshWorkspaceState, showNotice, handleError]);

  const handleCleanupLogs = useCallback(async () => {
    await runAction("cleanup-logs", async () => {
      const result = await api.cleanupLogs();
      setLogsDiagnostics(await api.getLogsDiagnostics());
      showNotice("success", `已清理 ${result.removedFiles} 个旧日志，释放 ${formatBytes(result.freedBytes)}`);
    }).catch(handleError);
  }, [runAction, showNotice, handleError]);

  const handleExportTaskLog = useCallback(async () => {
    if (!selectedTask) {
      showNotice("warning", "请先选择一个任务");
      return;
    }
    await runAction("export-task-log", async () => {
      const path = await api.pickSaveFile(`${selectedTask.taskId}.log`);
      if (!path) return;
      const savedPath = await api.exportTaskLog(selectedTask.taskId, path);
      showNotice("success", `任务日志已导出到 ${savedPath}`);
    }).catch(handleError);
  }, [selectedTask, runAction, showNotice, handleError]);

  const handleExportRepositoryLog = useCallback(async () => {
    if (!selectedRepo) {
      showNotice("warning", "请先选择一个仓库");
      return;
    }
    await runAction("export-repo-log", async () => {
      const path = await api.pickSaveFile(`${selectedRepo.id}.log`);
      if (!path) return;
      const savedPath = await api.exportRepositoryLog(selectedRepo.id, path);
      showNotice("success", `仓库日志已导出到 ${savedPath}`);
    }).catch(handleError);
  }, [selectedRepo, runAction, showNotice, handleError]);

  const handleExportConfig = useCallback(async () => {
    await runAction("export-config", async () => {
      const filename = `syncdock-config-${formatDateKey(new Date().toISOString())}.json`;
      const path = await api.pickSaveFile(filename);
      if (!path) return;
      const result = await api.exportConfig(path);
      showNotice("success", `配置已导出：${result.repositoryCount} 个仓库，${result.taskCount} 条任务摘要`);
    }).catch(handleError);
  }, [runAction, showNotice, handleError]);

  // Import functions
  const resetImportWizard = useCallback(() => {
    setImportSourcePath("");
    setImportPreview(null);
    setImportResult(null);
    setImportStrategy("merge");
    setImportSkipConflicts(true);
    setImportPathReplacements([{ from: "", to: "" }]);
  }, []);

  const closeImportModal = useCallback(() => {
    setImportModalOpen(false);
    resetImportWizard();
  }, [resetImportWizard]);

  const handleSelectImportConfig = useCallback(async () => {
    await runAction("preview-config", async () => {
      const path = await api.pickFile();
      if (!path) return;
      const preview = await api.previewConfigImport(path);
      setImportSourcePath(path);
      setImportPreview(preview);
      setImportResult(null);
      setImportStrategy("merge");
      setImportSkipConflicts(true);
      setImportPathReplacements([{ from: "", to: "" }]);
      setImportModalOpen(true);
    }).catch(handleError);
  }, [runAction, handleError]);

  const handleImportConfig = useCallback(async () => {
    if (!importSourcePath || !importPreview) {
      showNotice("warning", "请先选择并预检查一个配置包");
      return;
    }
    const normalizedReplacements = importPathReplacements
      .map((item) => ({ from: item.from.trim(), to: item.to.trim() }))
      .filter((item) => item.from && item.to);
    const canSkipConflicts = importStrategy === "merge" || importStrategy === "repositoriesOnly";

    await runAction("import-config", async () => {
      const result = await api.importConfig({
        source: importSourcePath,
        strategy: importStrategy as any,
        skipConflicts: canSkipConflicts ? importSkipConflicts : false,
        pathPrefixReplacements: normalizedReplacements
      });
      setImportResult(result);
      await refreshWorkspaceState(false);
      const parts = [
        `已导入 ${result.repositoryCount} 个仓库`,
        `${result.taskCount} 条任务摘要`,
        `策略：${getImportStrategyLabel(result.appliedStrategy)}`
      ];
      if (result.replacedPathCount) parts.push(`已替换 ${result.replacedPathCount} 条路径前缀`);
      if (result.invalidRepoPaths.length) parts.push(`${result.invalidRepoPaths.length} 个路径待重新定位`);
      if (result.skippedLogsDirectory) parts.push("已跳过不可用日志目录");
      showNotice("success", parts.join("，"));
    }).catch(handleError);
  }, [importSourcePath, importPreview, importStrategy, importSkipConflicts, importPathReplacements, runAction, refreshWorkspaceState, showNotice, handleError]);

  // Scan functions
  const handleScanRepositories = useCallback(async () => {
    if (!scanRootPath.trim()) {
      showNotice("warning", "请先选择扫描目录");
      return;
    }
    await runAction("scan", async () => {
      const result = await api.scanRepositories({ rootPath: scanRootPath, maxDepth: scanDepth });
      setScanResults(normalizeScannedRepositories(result));
      showNotice("success", `扫描完成，共发现 ${result.length} 个仓库候选项`);
    }).catch(handleError);
  }, [scanRootPath, scanDepth, runAction, showNotice, handleError]);

  const handleImportScannedRepositories = useCallback(async () => {
    const selected = scanResults
      .filter((repo) => repo.selected)
      .map((repo) => ({
        ...repo,
        name: repo.name.trim() || getPathLeafName(repo.path),
        group: repo.group.trim() || "未分组"
      }));
    if (!selected.length) {
      showNotice("warning", "请至少选择一个仓库");
      return;
    }
    await runAction("import", async () => {
      const imported = await api.importScannedRepositories(selected);
      setRepositories((current) => sortRepositories([...current, ...imported]));
      setScanModalOpen(false);
      setScanResults([]);
      showNotice("success", `已导入 ${imported.length} 个仓库`);
      await refreshWorkspaceState(false);
    }).catch(handleError);
  }, [scanResults, runAction, showNotice, refreshWorkspaceState, handleError]);

  const updateScanResult = useCallback((index: number, updater: (repo: ScannedRepository) => ScannedRepository) => {
    setScanResults((current) => current.map((repo, currentIndex) => (currentIndex === index ? updater(repo) : repo)));
  }, []);

  // Repository functions
  const handleAddRepository = useCallback(async () => {
    if (!draftRepo.path?.trim()) {
      showNotice("warning", "请填写本地仓库路径");
      return;
    }
    await runAction("add", async () => {
      const record = await api.addRepository(draftRepo);
      setRepositories((current) => sortRepositories([...current, record]));
      setSelectedRepoId(record.id);
      setAddModalOpen(false);
      setDraftRepo({ path: "", name: "", group: "未分组", note: "" });
      showNotice("success", "仓库已添加");
    }).catch(handleError);
  }, [draftRepo, runAction, showNotice, handleError]);

  const handleCloneRepository = useCallback(async () => {
    if (!cloneDraft.remoteUrl.trim() || !cloneDraft.destinationParent.trim()) {
      showNotice("warning", "请填写远端地址和目标目录");
      return;
    }
    await runAction("clone", async () => {
      const record = await api.cloneRepository(cloneDraft);
      setRepositories((current) => sortRepositories([...current, record]));
      setSelectedRepoId(record.id);
      setCloneModalOpen(false);
      setCloneDraft({ remoteUrl: "", destinationParent: "", directoryName: "", group: "未分组", note: "" });
      showNotice("success", "仓库已 clone 并加入管理");
    }).catch(handleError);
  }, [cloneDraft, runAction, showNotice, handleError]);

  const handleSaveRepository = useCallback(async () => {
    if (!repoForm) return;
    const nextForm: RepositoryUpdateInput = {
      ...repoForm,
      name: repoForm.name.trim(),
      path: repoForm.path.trim(),
      group: repoForm.group.trim() || "未分组",
      note: repoForm.note.trim()
    };
    if (!nextForm.path) {
      showNotice("warning", "请先填写仓库路径");
      return;
    }
    await runAction("repo-save", async () => {
      const updated = await api.updateRepository(nextForm);
      setRepositories((current) => current.map((repo) => (repo.id === updated.id ? updated : repo)));
      showNotice("success", "仓库信息已保存");
    }).catch(handleError);
  }, [repoForm, runAction, showNotice, handleError]);

  const handleRemoveRepository = useCallback(async () => {
    if (!selectedRepo) return;
    await runAction("repo-remove", async () => {
      await api.removeRepository(selectedRepo.id);
      setRepositories((current) => current.filter((repo) => repo.id !== selectedRepo.id));
      setSelectedRepoIds((current) => current.filter((id) => id !== selectedRepo.id));
      if (repoDetailRoute?.repoId === selectedRepo.id) {
        navigateToView(repoDetailRoute.originView, "replace");
      }
      showNotice("success", "仓库已移除");
    }).catch(handleError);
  }, [selectedRepo, repoDetailRoute, runAction, navigateToView, showNotice, handleError]);

  // Config directory functions
  const handleChangeConfigDirectory = useCallback(async () => {
    try {
      const path = await api.pickDirectory();
      if (!path) return;
      await runAction("config-directory", async () => {
        const nextDirectory = await api.setConfigDirectory(path);
        await refreshWorkspaceState(false);
        showNotice("success", `配置目录已切换到 ${nextDirectory}，建议重启应用以确保全部路径生效`);
      });
    } catch (error) {
      handleError(error);
    }
  }, [runAction, refreshWorkspaceState, showNotice, handleError]);

  const handleResetConfigDirectory = useCallback(async () => {
    if (!window.confirm("恢复默认配置目录后，后续配置将写回系统默认位置。确定继续吗？")) return;
    try {
      await runAction("config-directory", async () => {
        const nextDirectory = await api.setConfigDirectory(null);
        await refreshWorkspaceState(false);
        showNotice("success", `已恢复默认配置目录：${nextDirectory}，建议重启应用以确保全部路径生效`);
      });
    } catch (error) {
      handleError(error);
    }
  }, [runAction, refreshWorkspaceState, showNotice, handleError]);

  const handleResetLogsDirectory = useCallback(() => {
    if (!window.confirm("恢复默认日志目录后，后续新日志会写回应用默认位置。确定继续吗？")) return;
    setSettings((current) => ({ ...current, logsDirectory: "" }));
  }, []);

  // Selection functions
  const toggleRepoSelection = useCallback((repoId: string) => {
    setSelectedRepoIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId]
    );
  }, []);

  const toggleSelectAllVisible = useCallback(() => {
    const visibleIds = repositories.map((repo) => repo.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedRepoIds.includes(id));
    setSelectedRepoIds((current) => {
      if (allSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }, [repositories, selectedRepoIds]);

  const openTaskDetail = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskDetailModalOpen(true);
  }, []);

  // Context value
  const value = useMemo<AppContextValue>(() => ({
    // View state
    view, setView,
    overviewTab, setOverviewTab,
    overviewStatusFilter, setOverviewStatusFilter,
    repositoryTab, setRepositoryTab,
    taskTab, setTaskTab,
    settingsTab, setSettingsTab,
    repositoryGroupTab, setRepositoryGroupTab,

    // Route state
    repoDetailRoute,
    repoDetailOpen,
    activePrimaryView,
    updateRoute,
    navigateToView,
    openRepoDetail,
    closeRepoDetail,

    // Loading state
    loading,
    busyAction,

    // Data state
    repositories,
    tasks,
    syncTask,
    currentTaskRepoName,
    gitEnvironment,
    settings,
    configDirectory,
    logsDirectory,
    logsDiagnostics,
    // Data setters
    setSettings,
    setRepositories,
    setTasks,
    setSyncTask,
    setCurrentTaskRepoName,

    // Selection state
    selectedRepoId, setSelectedRepoId,
    selectedTaskId, setSelectedTaskId,
    selectedRepoIds, setSelectedRepoIds,
    repoForm, setRepoForm,

    // Log state
    taskLog,
    repositoryLog,
    repoLogSearch, setRepoLogSearch,
    repoLogLevelFilter, setRepoLogLevelFilter,
    taskLogSearch, setTaskLogSearch,
    taskLogLevelFilter, setTaskLogLevelFilter,

    // Filter state
    search, setSearch,
    statusFilter, setStatusFilter,
    groupFilter, setGroupFilter,
    taskSearch, setTaskSearch,
    taskResultFilter, setTaskResultFilter,
    taskDateFilter, setTaskDateFilter,

    // Notice state
    notice,
    setNotice,
    showNotice,
    showErrorNotice,

    // Modal state
    scanModalOpen, setScanModalOpen,
    addModalOpen, setAddModalOpen,
    cloneModalOpen, setCloneModalOpen,
    taskDetailModalOpen, setTaskDetailModalOpen,
    importModalOpen, setImportModalOpen,

    // Draft state
    draftRepo, setDraftRepo,
    cloneDraft, setCloneDraft,
    scanRootPath, setScanRootPath,
    scanDepth, setScanDepth,
    scanResults, setScanResults,

    // Import state
    importSourcePath, setImportSourcePath,
    importPreview, setImportPreview,
    importResult, setImportResult,
    importStrategy, setImportStrategy,
    importSkipConflicts, setImportSkipConflicts,
    importPathReplacements, setImportPathReplacements,

    // Computed values
    groups,
    languageMode,
    activeTask,
    selectedRepo,
    selectedTask,
    pendingCount,
    successCount,
    failedCount,
    warningCount,
    enabledCount,
    syncProgress,
    latestTask,

    // Actions
    refreshWorkspaceState,
    loadSnapshot,
    handleRefresh,
    handleSync,
    handleForceSync,
    handleCancelTask,
    handleSaveSettings,
    handleCleanupLogs,
    handleExportTaskLog,
    handleExportRepositoryLog,
    handleExportConfig,
    handleSelectImportConfig,
    handleImportConfig,
    handleScanRepositories,
    handleImportScannedRepositories,
    handleAddRepository,
    handleCloneRepository,
    handleSaveRepository,
    handleRemoveRepository,
    pickFolder,
    copyText,
    toggleRepoSelection,
    toggleSelectAllVisible,
    updateScanResult,
    handleChangeConfigDirectory,
    handleResetConfigDirectory,
    handleResetLogsDirectory,
    closeImportModal,
    openTaskDetail
  }), [
    view, overviewTab, overviewStatusFilter, repositoryTab, taskTab, settingsTab, repositoryGroupTab,
    repoDetailRoute, repoDetailOpen, activePrimaryView,
    loading, busyAction,
    repositories, tasks, syncTask, currentTaskRepoName, gitEnvironment, settings, configDirectory, logsDirectory, logsDiagnostics,
    selectedRepoId, selectedTaskId, selectedRepoIds, repoForm,
    taskLog, repositoryLog, repoLogSearch, repoLogLevelFilter, taskLogSearch, taskLogLevelFilter,
    search, statusFilter, groupFilter, taskSearch, taskResultFilter, taskDateFilter,
    notice,
    scanModalOpen, addModalOpen, cloneModalOpen, taskDetailModalOpen, importModalOpen,
    draftRepo, cloneDraft, scanRootPath, scanDepth, scanResults,
    importSourcePath, importPreview, importResult, importStrategy, importSkipConflicts, importPathReplacements,
    groups, languageMode, activeTask, selectedRepo, selectedTask,
    pendingCount, successCount, failedCount, warningCount, enabledCount, syncProgress, latestTask,
    updateRoute, navigateToView, openRepoDetail, closeRepoDetail,
    showNotice, showErrorNotice,
    refreshWorkspaceState, handleRefresh, handleSync, handleForceSync, handleCancelTask,
    handleSaveSettings, handleCleanupLogs, handleExportTaskLog, handleExportRepositoryLog, handleExportConfig,
    handleSelectImportConfig, handleImportConfig, handleScanRepositories, handleImportScannedRepositories,
    handleAddRepository, handleCloneRepository, handleSaveRepository, handleRemoveRepository,
    pickFolder, copyText, toggleRepoSelection, toggleSelectAllVisible, updateScanResult,
    handleChangeConfigDirectory, handleResetConfigDirectory, handleResetLogsDirectory,
    closeImportModal, openTaskDetail
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
