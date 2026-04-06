import { useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, toAppError } from "./api";
import type {
  AppErrorResponse,
  AppSettings,
  AppSnapshot,
  CloneRepositoryRequest,
  ConfigImportPreview,
  ConfigImportResult,
  GitEnvironment,
  ImportStrategy,
  LanguageMode,
  LogsDiagnostics,
  PathPrefixReplacement,
  PreferredView,
  ThemeMode,
  RepositoryDraftInput,

  RepositoryRecord,
  RepositoryUpdateInput,
  ScannedRepository,
  SyncProgressEvent,
  SyncTaskItemResult,
  SyncTaskRecord
} from "./types";



type ViewKey = "overview" | "repositories" | "tasks" | "settings";
type OverviewTab = "status" | "summary";
type RepositoryTab = "workspace" | "list" | "logs";
type SettingsTab = "general" | "sync" | "paths" | "repositories" | "about";
type TaskTab = "overview" | "history" | "detail" | "repoResults" | "logs";
type OverviewStatusFilter = "all" | "success" | "failed" | "warning" | "pending";
type RepoTone = "neutral" | "success" | "pending" | "warning" | "danger";
type TaskResultFilter = "all" | "failed" | "warning" | "success";
type LogLevelFilter = "all" | "warning" | "error";
type MainRouteState = { kind: "main"; view: ViewKey };
type RepoDetailRouteState = { kind: "repo-detail"; repoId: string; originView: ViewKey };
type RouteState = MainRouteState | RepoDetailRouteState;
type NavigationMode = "push" | "replace";



type ParsedLogLine = {
  index: number;
  text: string;
  level: "info" | "warning" | "error";
  repoName?: string | null;
  code?: string | null;
};

type NoticeState = {
  type: "success" | "warning" | "error";
  title: string;
  message?: string;
  code?: string;
  detail?: string;
  action?: string;
  retryable?: boolean;
};

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

const statusFilterOptions = [
  { value: "all", label: "全部状态" },
  { value: "needsSync", label: "待同步" },
  { value: "warning", label: "受保护跳过" },
  { value: "failed", label: "失败" },
  { value: "disabled", label: "已禁用" }
] as const;

const primaryNavItems: Array<{ key: ViewKey; icon: string }> = [
  { key: "overview", icon: "🏠" },
  { key: "repositories", icon: "📦" },
  { key: "tasks", icon: "📋" },
  { key: "settings", icon: "⚙️" }
];

const UI_TEXT = {
  "zh-CN": {
    navAriaLabel: "主导航",
    nav: {
      overview: "总览",
      repositories: "仓库",
      tasks: "任务",
      settings: "设置"
    },
    toolbar: {
      refresh: "刷新状态",
      syncAll: "同步全部",
      loading: "正在加载同步坞工作台…"
    },
    repoDetail: {
      eyebrow: "仓库",
      title: "仓库详情",
      back: "← 返回上一级"
    },
    overviewTabs: {
      status: "数据状态",
      summary: "运行摘要"
    },
    repositoryTabs: {
      workspace: "工作区",
      list: "清单",
      logs: "日志"
    },
    taskTabs: {
      overview: "概览",
      history: "历史任务",
      detail: "任务详情",
      repoResults: "仓库结果",
      logs: "日志中心"
    },
    settingsTabs: {
      general: "常规",
      sync: "同步",
      paths: "路径与目录",
      repositories: "仓库",
      about: "关于"
    },
    settings: {
      save: "保存设置",
      defaultView: "默认启动页",
      theme: "界面主题",
      language: "语言",
      windowClose: "窗口关闭行为",
      closeFixed: "退出应用（当前版本固定）",
      autoRefresh: "启动时自动刷新状态（当前默认开启）",
      themeSystem: "跟随系统",
      themeLight: "浅色模式",
      themeDark: "深色模式",
      langZh: "简体中文",
      langEn: "English"
    }
  },
  "en-US": {
    navAriaLabel: "Primary navigation",
    nav: {
      overview: "Overview",
      repositories: "Repositories",
      tasks: "Tasks",
      settings: "Settings"
    },
    toolbar: {
      refresh: "Refresh",
      syncAll: "Sync all",
      loading: "Loading SyncDock workspace..."
    },
    repoDetail: {
      eyebrow: "Repositories",
      title: "Repository Details",
      back: "← Back"
    },
    overviewTabs: {
      status: "Status",
      summary: "Summary"
    },
    repositoryTabs: {
      workspace: "Workspace",
      list: "List",
      logs: "Logs"
    },
    taskTabs: {
      overview: "Overview",
      history: "History",
      detail: "Details",
      repoResults: "Repository Results",
      logs: "Logs"
    },
    settingsTabs: {
      general: "General",
      sync: "Sync",
      paths: "Paths",
      repositories: "Repositories",
      about: "About"
    },
    settings: {
      save: "Save settings",
      defaultView: "Default start view",
      theme: "Theme",
      language: "Language",
      windowClose: "Window close behavior",
      closeFixed: "Exit app (fixed in current version)",
      autoRefresh: "Refresh status on startup (always on)",
      themeSystem: "Follow system",
      themeLight: "Light",
      themeDark: "Dark",
      langZh: "简体中文",
      langEn: "English"
    }
  }
} as const;



export default function App() {
  const [view, setView] = useState<ViewKey>(() => getInitialView());
  const [overviewTab, setOverviewTab] = useState<OverviewTab>("status");
  const [overviewStatusFilter, setOverviewStatusFilter] = useState<OverviewStatusFilter>("all");
  const [repositoryTab, setRepositoryTab] = useState<RepositoryTab>("workspace");
  const [taskTab, setTaskTab] = useState<TaskTab>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [repositoryGroupTab, setRepositoryGroupTab] = useState("all");
  const [repoDetailRoute, setRepoDetailRoute] = useState<RepoDetailRouteState | null>(() => getInitialRepoDetailRoute());
  const [loading, setLoading] = useState(true);


  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<RepositoryRecord[]>([]);
  const [tasks, setTasks] = useState<SyncTaskRecord[]>([]);
  const [syncTask, setSyncTask] = useState<SyncTaskRecord | null>(null);
  const [currentTaskRepoName, setCurrentTaskRepoName] = useState("");
  const [gitEnvironment, setGitEnvironment] = useState<GitEnvironment>(defaultGitEnvironment);
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [configDirectory, setConfigDirectory] = useState("");
  const [logsDirectory, setLogsDirectory] = useState("");
  const [logsDiagnostics, setLogsDiagnostics] = useState<LogsDiagnostics>(defaultLogsDiagnostics);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [taskLog, setTaskLog] = useState("");
  const [repositoryLog, setRepositoryLog] = useState("");
  const [repoLogSearch, setRepoLogSearch] = useState("");
  const [repoLogLevelFilter, setRepoLogLevelFilter] = useState<LogLevelFilter>("all");
  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState<(typeof statusFilterOptions)[number]["value"]>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskResultFilter, setTaskResultFilter] = useState<TaskResultFilter>("all");
  const [taskDateFilter, setTaskDateFilter] = useState("");
  const [taskLogSearch, setTaskLogSearch] = useState("");
  const [taskLogLevelFilter, setTaskLogLevelFilter] = useState<LogLevelFilter>("all");
  const [selectedRepoIds, setSelectedRepoIds] = useState<string[]>([]);
  const [repoForm, setRepoForm] = useState<RepositoryUpdateInput | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);


  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanRootPath, setScanRootPath] = useState("");
  const [scanDepth, setScanDepth] = useState(4);
  const [scanResults, setScanResults] = useState<ScannedRepository[]>([]);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [draftRepo, setDraftRepo] = useState<RepositoryDraftInput>({
    path: "",
    name: "",
    group: "未分组",
    note: ""
  });

  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneDraft, setCloneDraft] = useState<CloneRepositoryRequest>({
    remoteUrl: "",
    destinationParent: "",
    directoryName: "",
    group: "未分组",
    note: ""
  });

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importPreview, setImportPreview] = useState<ConfigImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ConfigImportResult | null>(null);
  const [importStrategy, setImportStrategy] = useState<ImportStrategy>("merge");
  const [importSkipConflicts, setImportSkipConflicts] = useState(true);
  const [importPathReplacements, setImportPathReplacements] = useState<PathPrefixReplacement[]>([{ from: "", to: "" }]);

  const repoDetailOpen = Boolean(repoDetailRoute);
  const activePrimaryView = repoDetailOpen ? "repositories" : view;
  const languageMode = normalizeLanguageMode(settings.languageMode);
  const text = UI_TEXT[languageMode];
  const currentViewLabel = repoDetailOpen ? text.repoDetail.eyebrow : "";
  const currentViewTitle = repoDetailOpen ? text.repoDetail.title : "";


  const updateRoute = (route: RouteState, mode: NavigationMode = "push") => {
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
  };

  const navigateToView = (nextView: ViewKey, mode: NavigationMode = "push") => {
    if (!repoDetailOpen && view === nextView) {
      if (mode === "replace") {
        window.history.replaceState({ kind: "main", view: nextView } satisfies MainRouteState, "", "/");
      }
      return;
    }
    updateRoute({ kind: "main", view: nextView }, mode);
  };

  const showNotice = (type: "success" | "warning" | "error", text: string) => {

    setNotice({ type, title: text });
  };

  const showErrorNotice = (parsed: AppErrorResponse) => {
    const type = parsed.level === "warning" || parsed.level === "info" ? "warning" : "error";
    setNotice({
      type,
      title: parsed.title,
      message: parsed.message,
      code: parsed.code,
      detail: parsed.detail ?? undefined,
      action: parsed.action ?? undefined,
      retryable: parsed.retryable
    });
  };

  const handleError = (error: unknown) => {
    showErrorNotice(toAppError(error));
  };


  const applySnapshot = (snapshot: AppSnapshot, applyPreferredView = false) => {
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
      return snapshot.repositories[0]?.id ?? "";
    });

    setSelectedTaskId((current) => {
      if (current && snapshot.tasks.some((task) => task.taskId === current)) {
        return current;
      }
      return snapshot.tasks[0]?.taskId ?? "";
    });

    setSelectedRepoIds((current) => current.filter((id) => snapshot.repositories.some((repo) => repo.id === id)));
  };

  const refreshWorkspaceState = async (applyPreferredView = false) => {
    const [snapshot, diagnostics] = await Promise.all([api.getAppSnapshot(), api.getLogsDiagnostics()]);
    applySnapshot(snapshot, applyPreferredView);
    setLogsDiagnostics(diagnostics);
  };

  const loadSnapshot = async () => {
    try {
      setLoading(true);
      await refreshWorkspaceState(true);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initialRoute = readRouteStateFromLocation() ?? { kind: "main", view: "overview" } satisfies MainRouteState;
    window.history.replaceState(initialRoute, "", buildRoutePath(initialRoute));
    if (initialRoute.kind === "repo-detail") {
      setRepoDetailRoute(initialRoute);
      setSelectedRepoId(initialRoute.repoId);
      setView("repositories");
      return;
    }
    setRepoDetailRoute(null);
    setView(initialRoute.view);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const route = readRouteStateFromLocation() ?? { kind: "main", view: "overview" } satisfies MainRouteState;
      if (route.kind === "repo-detail") {
        setRepoDetailRoute(route);
        setSelectedRepoId(route.repoId);
        setView("repositories");
        return;
      }
      setRepoDetailRoute(null);
      setView(route.view);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = settings.themeMode === "system" ? (media.matches ? "dark" : "light") : settings.themeMode;
      root.dataset.theme = resolvedTheme;
      root.style.colorScheme = resolvedTheme;
    };

    applyTheme();
    if (settings.themeMode !== "system") {
      return;
    }

    const handleChange = () => applyTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [settings.themeMode]);

  useEffect(() => {
    void loadSnapshot();

    let disposed = false;
    const unlisten = listen<SyncProgressEvent>("sync-progress", (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSyncTask(payload.task);
      setCurrentTaskRepoName(payload.currentRepoName ?? "");
      setTasks((current) => mergeTasks(current, payload.task));
    });

    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (repoDetailRoute && selectedRepoId !== repoDetailRoute.repoId) {
      setSelectedRepoId(repoDetailRoute.repoId);
    }
  }, [repoDetailRoute, selectedRepoId]);

  useEffect(() => {
    if (!selectedRepoId) {
      setRepoForm(null);
      return;
    }
    const repo = repositories.find((item) => item.id === selectedRepoId);
    if (!repo) {
      setRepoForm(null);
      return;
    }
    setRepoForm({
      id: repo.id,
      name: repo.name,
      path: repo.path,
      group: repo.group,
      note: repo.note,
      enabled: repo.enabled
    });

  }, [selectedRepoId, repositories]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskLog("");
      return;
    }
    void (async () => {
      try {
        const log = await api.getTaskLog(selectedTaskId);
        setTaskLog(log);
      } catch (error) {
        handleError(error);
      }
    })();
  }, [selectedTaskId, syncTask?.taskId, syncTask?.completed, syncTask?.running]);

  useEffect(() => {
    if (!selectedRepoId || !repositories.some((repo) => repo.id === selectedRepoId)) {
      setRepositoryLog("");
      return;
    }
    void (async () => {
      try {
        const log = await api.getRepositoryLog(selectedRepoId);
        setRepositoryLog(log);
      } catch (error) {
        handleError(error);
      }
    })();
  }, [repositories, selectedRepoId, syncTask?.taskId, syncTask?.completed, syncTask?.running]);


  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const groups = useMemo(
    () => Array.from(new Set(repositories.map((repo) => repo.group).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [repositories]
  );
  const repoGroupOptions = useMemo(
    () => Array.from(new Set(["未分组", ...groups, repoForm?.group ?? ""].filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [groups, repoForm?.group]
  );

  const repositoryViewData = useMemo(() => {

    return repositories.filter((repo) => {
      const keyword = search.trim().toLowerCase();
      const textMatch =
        !keyword ||
        [repo.name, repo.path, repo.group, repo.note, repo.status.currentBranch]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(keyword));

      const groupMatch = groupFilter === "all" || repo.group === groupFilter;
      const meta = getRepositoryMeta(repo, settings);
      const statusMatch =
        statusFilter === "all"
          ? true
          : statusFilter === "needsSync"
            ? repo.status.syncRequired
            : statusFilter === "warning"
              ? meta.tone === "warning"
              : statusFilter === "failed"
                ? meta.tone === "danger"
                : !repo.enabled;

      return textMatch && groupMatch && statusMatch;
    });
  }, [repositories, search, groupFilter, statusFilter, settings]);

  const groupSummaries = useMemo(
    () =>
      groups.map((group) => {
        const items = repositories.filter((repo) => repo.group === group);
        return {
          group,
          total: items.length,
          enabled: items.filter((repo) => repo.enabled).length,
          pending: items.filter((repo) => repo.status.syncRequired).length,
          failed: items.filter((repo) => getRepositoryMeta(repo, settings).tone === "danger").length
        };
      }),
    [groups, repositories, settings]
  );

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const keyword = taskSearch.trim().toLowerCase();
      const textMatch =
        !keyword ||
        [task.taskId, task.summaryMessage, getTaskModeLabel(task.mode), ...task.items.map((item) => item.repoName)]
          .join(" ")
          .toLowerCase()
          .includes(keyword);

      const resultMatch =
        taskResultFilter === "all"
          ? true
          : taskResultFilter === "failed"
            ? task.failedCount > 0
            : taskResultFilter === "warning"
              ? task.skippedCount > 0 || task.cancelledCount > 0
              : task.failedCount === 0 && task.skippedCount === 0 && task.cancelledCount === 0;


      const dateMatch = !taskDateFilter || getDateKey(task.startTime) === taskDateFilter;
      return textMatch && resultMatch && dateMatch;
    });
  }, [taskDateFilter, taskResultFilter, taskSearch, tasks]);

  const activeTask = syncTask?.running ? syncTask : tasks.find((task) => task.running) ?? null;
  const selectedRepo = repositories.find((repo) => repo.id === selectedRepoId) ?? null;
  const selectedTask =
    tasks.find((task) => task.taskId === selectedTaskId) ??
    (syncTask?.taskId === selectedTaskId ? syncTask : null) ??
    tasks[0] ??
    syncTask;
  const activeTaskStatusHint = activeTask ? getTaskStatusHint(activeTask, currentTaskRepoName) : "";
  const selectedTaskStatusHint =
    selectedTask
      ? getTaskStatusHint(selectedTask, selectedTask.taskId === activeTask?.taskId ? currentTaskRepoName : "")
      : "";
  const displayedTaskItems = useMemo(

    () => (selectedTask ? prioritizeTaskItems(selectedTask.items) : []),
    [selectedTask]
  );
  const taskCodeSummary = useMemo(
    () => aggregateTaskCodes(selectedTask?.items ?? []),
    [selectedTask]
  );
  const parsedLogLines = useMemo(() => parseTaskLog(taskLog), [taskLog]);
  const filteredLogLines = useMemo(() => {
    const keyword = taskLogSearch.trim().toLowerCase();
    return parsedLogLines.filter((line) => {
      const keywordMatch =
        !keyword ||
        [line.text, line.repoName ?? "", line.code ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const levelMatch =
        taskLogLevelFilter === "all"
          ? true
          : taskLogLevelFilter === "warning"
            ? line.level === "warning"
            : line.level === "error";
      return keywordMatch && levelMatch;
    });
  }, [parsedLogLines, taskLogLevelFilter, taskLogSearch]);
  const parsedRepositoryLogLines = useMemo(() => parseTaskLog(repositoryLog), [repositoryLog]);
  const filteredRepositoryLogLines = useMemo(() => {
    const keyword = repoLogSearch.trim().toLowerCase();
    return parsedRepositoryLogLines.filter((line) => {
      const keywordMatch =
        !keyword ||
        [line.text, line.repoName ?? "", line.code ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      const levelMatch =
        repoLogLevelFilter === "all"
          ? true
          : repoLogLevelFilter === "warning"
            ? line.level === "warning"
            : line.level === "error";
      return keywordMatch && levelMatch;
    });
  }, [parsedRepositoryLogLines, repoLogLevelFilter, repoLogSearch]);
  const normalizedImportPathReplacements = useMemo(

    () => importPathReplacements
      .map((item) => ({ from: item.from.trim(), to: item.to.trim() }))
      .filter((item) => item.from && item.to),
    [importPathReplacements]
  );
  const canSkipImportConflicts = importStrategy === "merge" || importStrategy === "repositoriesOnly";

  const pendingCount = repositories.filter((repo) => repo.status.syncRequired).length;
  const successCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "success").length;
  const failedCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "danger").length;
  const warningCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "warning").length;
  const enabledCount = repositories.filter((repo) => repo.enabled).length;
  const syncProgress = activeTask && activeTask.total > 0 ? (activeTask.completed / activeTask.total) * 100 : 0;
  const latestTask = tasks[0] ?? activeTask;
  const overviewRepositories = useMemo(
    () =>
      sortRepositories(repositories).filter((repo) => matchesOverviewStatusFilter(repo, overviewStatusFilter, settings)),
    [overviewStatusFilter, repositories, settings]
  );
  const workspaceRepositories = useMemo(
    () =>
      sortRepositories(repositories).filter((repo) => repositoryGroupTab === "all" || repo.group === repositoryGroupTab),
    [repositories, repositoryGroupTab]
  );
  const recentFailedItems = useMemo(
    () => prioritizeTaskItems(latestTask?.items ?? []).filter((item) => item.state === "failed").slice(0, 6),
    [latestTask]
  );
  const repositoryResultItems = useMemo(() => {
    const latestByRepo = new Map<string, SyncTaskItemResult>();
    const runCountByRepo = new Map<string, number>();

    tasks.forEach((task) => {
      task.items.forEach((item) => {
        runCountByRepo.set(item.repoId, (runCountByRepo.get(item.repoId) ?? 0) + 1);
        const current = latestByRepo.get(item.repoId);
        if (!current || item.finishedAt > current.finishedAt) {
          latestByRepo.set(item.repoId, item);
        }
      });
    });

    return sortRepositories(repositories)
      .map((repo) => {
        const latestItem = latestByRepo.get(repo.id);
        return {
          repo,
          latestItem,
          runCount: runCountByRepo.get(repo.id) ?? 0
        };
      })
      .filter((item) => item.latestItem);
  }, [repositories, tasks]);

  const openRepoDetail = (repoId: string, originView: ViewKey = activePrimaryView) => {
    updateRoute({ kind: "repo-detail", repoId, originView }, "push");
  };

  const closeRepoDetail = () => {
    navigateToView(repoDetailRoute?.originView ?? "repositories", "replace");
  };

  const openTaskDetail = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskTab("detail");
  };

  const runAction = async (actionName: string, action: () => Promise<void>) => {


    try {
      setBusyAction(actionName);
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const pickFolder = async (setter: (value: string) => void) => {
    try {
      const path = await api.pickDirectory();
      if (path) {
        setter(path);
      }
    } catch (error) {
      handleError(error);
    }
  };

  const handleChangeConfigDirectory = async () => {
    try {
      const path = await api.pickDirectory();
      if (!path) {
        return;
      }
      await runAction("config-directory", async () => {
        const nextDirectory = await api.setConfigDirectory(path);
        await refreshWorkspaceState(false);
        showNotice("success", `配置目录已切换到 ${nextDirectory}，建议重启应用以确保全部路径生效`);
      });
    } catch (error) {
      handleError(error);
    }
  };

  const handleResetConfigDirectory = async () => {
    if (!window.confirm("恢复默认配置目录后，后续配置将写回系统默认位置。确定继续吗？")) {
      return;
    }
    try {
      await runAction("config-directory", async () => {
        const nextDirectory = await api.setConfigDirectory(null);
        await refreshWorkspaceState(false);
        showNotice("success", `已恢复默认配置目录：${nextDirectory}，建议重启应用以确保全部路径生效`);
      });
    } catch (error) {
      handleError(error);
    }
  };

  const handleResetLogsDirectory = () => {
    if (!window.confirm("恢复默认日志目录后，后续新日志会写回应用默认位置。确定继续吗？")) {
      return;
    }
    setSettings((current) => ({ ...current, logsDirectory: "" }));
  };

  const copyText = async (value: string, successText: string) => {

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
  };

  const handleRefresh = async (repoIds?: string[]) => {
    await runAction("refresh", async () => {
      const refreshed = await api.refreshRepositories(repoIds);
      setRepositories(refreshed);
      showNotice("success", "状态已刷新");
    }).catch(handleError);
  };

  const handleSync = async (repoIds?: string[], group?: string) => {
    await runAction("sync", async () => {
      showNotice("success", "同步任务已启动");
      const task = await api.syncRepositories(repoIds, group);
      setSyncTask(task);
      setTasks((current) => mergeTasks(current, task));
      setSelectedTaskId(task.taskId);
      await refreshWorkspaceState(false);
      showNotice("success", task.summaryMessage);
      navigateToView("tasks");
    }).catch(handleError);
  };

  const handleCancelTask = async (taskId?: string) => {
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
  };


  const handleSaveSettings = async () => {

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
  };

  const handleCleanupLogs = async () => {
    await runAction("cleanup-logs", async () => {
      const result = await api.cleanupLogs();
      setLogsDiagnostics(await api.getLogsDiagnostics());
      showNotice("success", `已清理 ${result.removedFiles} 个旧日志，释放 ${formatBytes(result.freedBytes)}`);
    }).catch(handleError);
  };

  const handleExportTaskLog = async () => {
    if (!selectedTask) {
      showNotice("warning", "请先选择一个任务");
      return;
    }
    await runAction("export-task-log", async () => {
      const path = await api.pickSaveFile(`${selectedTask.taskId}.log`);
      if (!path) {
        return;
      }
      const savedPath = await api.exportTaskLog(selectedTask.taskId, path);
      showNotice("success", `任务日志已导出到 ${savedPath}`);
    }).catch(handleError);
  };

  const handleExportRepositoryLog = async () => {
    if (!selectedRepo) {
      showNotice("warning", "请先选择一个仓库");
      return;
    }
    await runAction("export-repo-log", async () => {
      const path = await api.pickSaveFile(`${selectedRepo.id}.log`);
      if (!path) {
        return;
      }
      const savedPath = await api.exportRepositoryLog(selectedRepo.id, path);
      showNotice("success", `仓库日志已导出到 ${savedPath}`);
    }).catch(handleError);
  };

  const handleExportConfig = async () => {

    await runAction("export-config", async () => {
      const filename = `syncdock-config-${getDateKey(new Date().toISOString())}.json`;
      const path = await api.pickSaveFile(filename);
      if (!path) {
        return;
      }
      const result = await api.exportConfig(path);
      showNotice("success", `配置已导出：${result.repositoryCount} 个仓库，${result.taskCount} 条任务摘要`);
    }).catch(handleError);
  };

  const resetImportWizard = () => {
    setImportSourcePath("");
    setImportPreview(null);
    setImportResult(null);
    setImportStrategy("merge");
    setImportSkipConflicts(true);
    setImportPathReplacements([{ from: "", to: "" }]);
  };

  const closeImportModal = () => {
    setImportModalOpen(false);
    resetImportWizard();
  };

  const handleSelectImportConfig = async () => {
    await runAction("preview-config", async () => {
      const path = await api.pickFile();
      if (!path) {
        return;
      }
      const preview = await api.previewConfigImport(path);
      setImportSourcePath(path);
      setImportPreview(preview);
      setImportResult(null);
      setImportStrategy("merge");
      setImportSkipConflicts(true);
      setImportPathReplacements([{ from: "", to: "" }]);
      setImportModalOpen(true);
    }).catch(handleError);
  };

  const handleImportConfig = async () => {
    if (!importSourcePath || !importPreview) {
      showNotice("warning", "请先选择并预检查一个配置包");
      return;
    }
    await runAction("import-config", async () => {
      const result = await api.importConfig({
        source: importSourcePath,
        strategy: importStrategy,
        skipConflicts: canSkipImportConflicts ? importSkipConflicts : false,
        pathPrefixReplacements: normalizedImportPathReplacements
      });
      setImportResult(result);
      await refreshWorkspaceState(false);
      const parts = [
        `已导入 ${result.repositoryCount} 个仓库`,
        `${result.taskCount} 条任务摘要`,
        `策略：${getImportStrategyLabel(result.appliedStrategy)}`
      ];
      if (result.replacedPathCount) {
        parts.push(`已替换 ${result.replacedPathCount} 条路径前缀`);
      }
      if (result.invalidRepoPaths.length) {
        parts.push(`${result.invalidRepoPaths.length} 个路径待重新定位`);
      }
      if (result.skippedLogsDirectory) {
        parts.push("已跳过不可用日志目录");
      }
      showNotice("success", parts.join("，"));
    }).catch(handleError);
  };


  const handleScanRepositories = async () => {
    if (!scanRootPath.trim()) {
      showNotice("warning", "请先选择扫描目录");
      return;
    }
    await runAction("scan", async () => {
      const result = await api.scanRepositories({ rootPath: scanRootPath, maxDepth: scanDepth });
      setScanResults(normalizeScannedRepositories(result));
      showNotice("success", `扫描完成，共发现 ${result.length} 个仓库候选项`);
    }).catch(handleError);
  };

  const handleImportScannedRepositories = async () => {
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
  };

  const updateScanResult = (index: number, updater: (repo: ScannedRepository) => ScannedRepository) => {
    setScanResults((current) => current.map((repo, currentIndex) => (currentIndex === index ? updater(repo) : repo)));
  };

  const handleAddRepository = async () => {

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
  };

  const handleCloneRepository = async () => {
    if (!cloneDraft.remoteUrl.trim() || !cloneDraft.destinationParent.trim()) {
      showNotice("warning", "请填写远端地址和目标目录");
      return;
    }
    await runAction("clone", async () => {
      const record = await api.cloneRepository(cloneDraft);
      setRepositories((current) => sortRepositories([...current, record]));
      setSelectedRepoId(record.id);
      setCloneModalOpen(false);
      setCloneDraft({
        remoteUrl: "",
        destinationParent: "",
        directoryName: "",
        group: "未分组",
        note: ""
      });
      showNotice("success", "仓库已 clone 并加入管理");
    }).catch(handleError);
  };

  const handleSaveRepository = async () => {
    if (!repoForm) {
      return;
    }

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
  };


  const handleRemoveRepository = async () => {
    if (!selectedRepo) {
      return;
    }
    await runAction("repo-remove", async () => {
      await api.removeRepository(selectedRepo.id);
      setRepositories((current) => current.filter((repo) => repo.id !== selectedRepo.id));
      setSelectedRepoIds((current) => current.filter((id) => id !== selectedRepo.id));
      if (repoDetailRoute?.repoId === selectedRepo.id) {
        navigateToView(repoDetailRoute.originView, "replace");
      }
      showNotice("success", "仓库已移除");
    }).catch(handleError);
  };


  const toggleRepoSelection = (repoId: string) => {
    setSelectedRepoIds((current) =>
      current.includes(repoId) ? current.filter((id) => id !== repoId) : [...current, repoId]
    );
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = repositoryViewData.map((repo) => repo.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedRepoIds.includes(id));
    setSelectedRepoIds((current) => {
      if (allSelected) {
        return current.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <nav className="nav-list" aria-label={text.navAriaLabel}>
          {primaryNavItems.map((item) => (
            <NavButton
              key={item.key}
              active={activePrimaryView === item.key}
              icon={item.icon}
              label={text.nav[item.key]}
              onClick={() => navigateToView(item.key)}
            />
          ))}

        </nav>
      </aside>


      <main className="workspace">
        <header className="topbar">
          <div className="topbar-leading">
            {repoDetailOpen ? (
              <div>
                <p className="eyebrow">{currentViewLabel}</p>
                <h2>{currentViewTitle}</h2>
              </div>
            ) : (
              <div className="topbar-context">
                {view === "settings" && settingsTab !== "about" ? (
                  <button className="primary-button" onClick={() => void handleSaveSettings()} disabled={busyAction === "settings"}>
                    {text.settings.save}
                  </button>
                ) : null}
                {activePrimaryView === "repositories" && !repoDetailOpen ? (
                  <>
                    <button className="ghost-button" onClick={() => setScanModalOpen(true)}>扫描导入</button>
                    <button className="ghost-button" onClick={() => setAddModalOpen(true)}>添加仓库</button>
                  </>
                ) : null}
              </div>
            )}
          </div>
          <div className="toolbar-actions">
            {activePrimaryView === "repositories" && !repoDetailOpen ? (
              <label className="search-box">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索仓库名、路径、备注、分支" />
              </label>
            ) : null}

            <button className="ghost-button" onClick={() => void handleRefresh()} disabled={busyAction === "refresh"}>
              {text.toolbar.refresh}
            </button>
            <button className="primary-button" onClick={() => void handleSync()} disabled={busyAction === "sync" || !gitEnvironment.available}>
              {text.toolbar.syncAll}
            </button>
          </div>
        </header>


        {notice ? (

          <div className={`notice ${notice.type}`}>
            <div className="notice-header">
              <strong>{notice.code ? `${notice.title}（${notice.code}）` : notice.title}</strong>
              {notice.retryable ? <span className="notice-flag">可重试</span> : null}
            </div>
            {notice.message ? <p>{notice.message}</p> : null}
            {notice.action ? <p className="notice-meta">建议操作：{notice.action}</p> : null}
            {notice.detail ? <p className="notice-detail">技术细节：{notice.detail}</p> : null}
          </div>
        ) : null}


        {loading ? (
          <div className="loading-panel">{text.toolbar.loading}</div>
        ) : (
          <div className="content-layout single-column">
            {view === "overview" && (
              <section className="card panel">
                <TabBar
                  items={[
                    { key: "status", label: text.overviewTabs.status },
                    { key: "summary", label: text.overviewTabs.summary }
                  ]}

                  activeKey={overviewTab}
                  onChange={(key) => setOverviewTab(key as OverviewTab)}
                />

                {overviewTab === "status" ? (
                  <div className="view-stack">
                    <div className="metric-grid">
                      {[
                        { key: "all", label: "仓库总数", value: repositories.length, tone: "neutral" },
                        { key: "success", label: "成功", value: successCount, tone: "success" },
                        { key: "failed", label: "失败", value: failedCount, tone: "danger" },
                        { key: "warning", label: "跳过", value: warningCount, tone: "warning" },
                        { key: "pending", label: "待同步", value: pendingCount, tone: "pending" }
                      ].map((item) => (
                        <button
                          key={item.key}
                          className={`metric-button ${item.tone} ${overviewStatusFilter === item.key ? "active" : ""}`}
                          onClick={() => setOverviewStatusFilter(item.key as OverviewStatusFilter)}
                        >
                          <span className="metric-label">{item.label}</span>
                          <strong className="metric-value">{item.value}</strong>
                        </button>
                      ))}
                    </div>
                    <div className="panel-header mini">
                      <div>
                        <h4>仓库列表</h4>
                        <p className="muted">仅展示名称、分支、状态与最近同步时间。</p>
                      </div>
                      {overviewStatusFilter !== "all" ? (
                        <button className="ghost-button" onClick={() => setOverviewStatusFilter("all")}>清除筛选</button>
                      ) : null}
                    </div>
                    <div className="repo-list">
                      {overviewRepositories.map((repo) => {
                        const meta = getRepositoryMeta(repo, settings);
                        return (
                          <article key={repo.id} className="repo-item compact-row">
                            <div className="repo-main">
                              <div className="repo-title-row">
                                <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "overview")}>{repo.name}</button>
                              </div>
                              <div className="repo-meta-row">
                                <span>分支：{repo.status.currentBranch || "-"}</span>
                                <span>最近同步：{formatDateTime(repo.lastSyncAt)}</span>
                              </div>
                            </div>
                            <div className="repo-side">
                              <Badge tone={meta.tone} text={meta.label} />
                            </div>
                          </article>
                        );

                      })}
                      {!overviewRepositories.length ? <EmptyState title="暂无匹配仓库" description="当前筛选条件下没有仓库记录。" /> : null}
                    </div>
                  </div>
                ) : (
                  <div className="view-stack">
                    <div className="panel-grid two-columns">
                      <section className="inset-card">
                        <div className="panel-header mini">
                          <div>
                            <h4>最近一次同步</h4>
                            <p className="muted">时间、类型、结果汇总集中展示。</p>
                          </div>
                        </div>
                        {latestTask ? (
                          <>
                            <div className="summary-row wrap">
                              <Badge tone={toneFromTaskRecord(latestTask)} text={getTaskStatusLabel(latestTask)} />
                              <span className="helper">{formatDateTime(latestTask.startTime)}</span>
                            </div>
                            <p>{latestTask.summaryMessage}</p>
                            <div className="summary-row wrap">
                              <SummaryPill label="成功" value={latestTask.successCount} tone="success" />
                              <SummaryPill label="跳过" value={latestTask.skippedCount} tone="warning" />
                              <SummaryPill label="失败" value={latestTask.failedCount} tone="danger" />
                              <SummaryPill label="耗时" value={formatDuration(latestTask.items.reduce((sum, item) => sum + item.durationMs, 0))} tone="neutral" />
                            </div>
                          </>
                        ) : (
                          <EmptyState title="暂无任务摘要" description="执行一次同步后，这里会显示最近运行摘要。" />
                        )}
                      </section>
                      <section className="inset-card">
                        <div className="panel-header mini">
                          <div>
                            <h4>最近失败仓库</h4>
                            <p className="muted">优先展示失败原因，便于快速排障。</p>
                          </div>
                        </div>
                        <div className="stack-list compact-list">
                          {recentFailedItems.map((item) => (
                            <div key={`${item.repoId}-${item.finishedAt}`} className="list-item preview-item">
                              <div className="summary-row wrap">
                                <button className="text-link-button" onClick={() => openRepoDetail(item.repoId, "overview")}>{item.repoName}</button>
                                <Badge tone="danger" text={item.title} />
                              </div>
                              <p className="muted">{item.detail}</p>
                            </div>
                          ))}
                          {!recentFailedItems.length ? <EmptyState title="最近没有失败仓库" description="最近任务执行正常时，这里会保持清爽空状态。" /> : null}
                        </div>
                      </section>
                    </div>
                    <section className="inset-card">
                      <div className="panel-header mini">
                        <div>
                          <h4>同步趋势</h4>
                          <p className="muted">当前先保留占位，后续可扩展最近 7 天趋势图。</p>
                        </div>
                      </div>
                      <EmptyState title="趋势图占位中" description="当前版本先完成结构迁移，后续补充统计趋势可视化。" />
                    </section>
                  </div>
                )}
              </section>
            )}

            {activePrimaryView === "repositories" && repoDetailOpen ? (

              <section className="card panel">
                <div className="panel-header">
                  <div>
                    <button className="text-link-button" onClick={closeRepoDetail}>{text.repoDetail.back}</button>
                    <h3>{selectedRepo?.name || text.repoDetail.title}</h3>
                    <p className="muted">独立详情视图承接编辑、日志与快捷操作。</p>
                  </div>

                  {selectedRepo ? <Badge tone={getRepositoryMeta(selectedRepo, settings).tone} text={getRepositoryMeta(selectedRepo, settings).label} /> : null}
                </div>
                {selectedRepo && repoForm ? (
                  <div className="view-stack">
                    <div className="summary-row wrap">
                      <SummaryPill label="ahead" value={selectedRepo.status.aheadCount} tone="neutral" />
                      <SummaryPill label="behind" value={selectedRepo.status.behindCount} tone="pending" />
                      <SummaryPill label="本地改动" value={selectedRepo.status.hasUncommittedChanges ? "有" : "无"} tone={selectedRepo.status.hasUncommittedChanges ? "warning" : "success"} />
                      <SummaryPill label="启用" value={repoForm.enabled ? "是" : "否"} tone={repoForm.enabled ? "success" : "neutral"} />
                    </div>
                    <div className="form-grid two-columns">
                      <label>
                        <span>仓库名称</span>
                        <input value={repoForm.name} onChange={(event) => setRepoForm((current) => current ? { ...current, name: event.target.value } : current)} />
                      </label>
                      <label>
                        <span>分组</span>
                        <input
                          list="repo-group-options"
                          value={repoForm.group}
                          onChange={(event) => setRepoForm((current) => current ? { ...current, group: event.target.value } : current)}
                          placeholder="选择或输入分组"
                        />
                        <datalist id="repo-group-options">
                          {repoGroupOptions.map((group) => <option key={group} value={group} />)}
                        </datalist>
                      </label>
                      <label className="full-span">
                        <span>仓库路径</span>
                        <div className="path-input">
                          <input value={repoForm.path} onChange={(event) => setRepoForm((current) => current ? { ...current, path: event.target.value } : current)} placeholder="例如 D:/Code/SyncDock" />
                          <button type="button" className="ghost-button" onClick={() => void pickFolder((value) => setRepoForm((current) => current ? { ...current, path: value } : current))}>选择目录</button>
                        </div>
                      </label>
                      <label className="full-span">
                        <span>备注</span>
                        <textarea value={repoForm.note} onChange={(event) => setRepoForm((current) => current ? { ...current, note: event.target.value } : current)} rows={3} />
                      </label>
                      <label className="switch-row">
                        <input type="checkbox" checked={repoForm.enabled} onChange={(event) => setRepoForm((current) => current ? { ...current, enabled: event.target.checked } : current)} />
                        <span>启用该仓库参与同步</span>
                      </label>
                    </div>

                    <div className="info-grid compact">
                      <InfoField label="remote URL" value={selectedRepo.remoteUrl || "-"} />
                      <InfoField label="当前分支" value={selectedRepo.status.currentBranch || "-"} />
                      <InfoField label="upstream" value={selectedRepo.status.upstreamName || "未配置"} />
                      <InfoField label="最近同步" value={formatDateTime(selectedRepo.lastSyncAt)} />
                      <InfoField label="最近结果" value={selectedRepo.lastSyncMessage || "-"} />
                      <InfoField label="状态说明" value={selectedRepo.status.statusText || "-"} />
                    </div>
                    <div className="inline-actions wrap">
                      <button className="primary-button" onClick={() => void handleSaveRepository()} disabled={busyAction === "repo-save"}>保存信息</button>
                      <button className="ghost-button" onClick={() => void handleSync([selectedRepo.id])}>立即同步</button>
                      <button className="ghost-button" onClick={() => void handleRefresh([selectedRepo.id])}>刷新状态</button>
                      <button className="ghost-button" onClick={() => void api.openExternal(repoForm.path)} disabled={!repoForm.path.trim()}>打开目录</button>
                      <button className="ghost-button" onClick={() => void copyText(repoForm.path, "路径已复制")}>复制路径</button>
                      <button className="danger-button" onClick={() => void handleRemoveRepository()} disabled={busyAction === "repo-remove"}>移除仓库</button>
                    </div>

                    <section className="inset-card">
                      <div className="panel-header mini">
                        <div>
                          <h4>同步日志</h4>
                          <p className="muted">当前仓库历史日志，支持筛选和导出。</p>
                        </div>
                        <div className="inline-actions wrap">
                          <button className="ghost-button" onClick={() => void copyText(filteredRepositoryLogLines.map((line) => line.text).join("\n") || repositoryLog, "仓库日志已复制")}>复制日志</button>
                          <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={busyAction === "export-repo-log"}>导出日志</button>
                        </div>
                      </div>
                      <div className="task-log-toolbar">
                        <label className="search-box compact-search">
                          <input value={repoLogSearch} onChange={(event) => setRepoLogSearch(event.target.value)} placeholder="搜索仓库日志、错误码" />
                        </label>
                        <select value={repoLogLevelFilter} onChange={(event) => setRepoLogLevelFilter(event.target.value as LogLevelFilter)}>
                          <option value="all">全部日志</option>
                          <option value="warning">仅警告</option>
                          <option value="error">仅错误</option>
                        </select>
                      </div>
                      <div className="log-line-list repo-log-list">
                        {filteredRepositoryLogLines.slice(0, 160).map((line) => (
                          <div key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                            <span className="log-line-index">#{line.index}</span>
                            <div className="log-line-badges">
                              <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                              {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                            </div>
                            <code className="log-line-text">{line.text}</code>
                          </div>
                        ))}
                        {!filteredRepositoryLogLines.length ? <EmptyState title="暂无日志记录" description="该仓库还没有可展示的日志。" /> : null}
                      </div>
                    </section>
                  </div>
                ) : (
                  <EmptyState title="未找到仓库" description="请返回仓库页重新选择仓库。" />
                )}
              </section>
            ) : null}

            {activePrimaryView === "repositories" && !repoDetailOpen ? (

              <section className="card panel">
                <TabBar

                  items={[
                    { key: "workspace", label: text.repositoryTabs.workspace },
                    { key: "list", label: text.repositoryTabs.list },
                    { key: "logs", label: text.repositoryTabs.logs }
                  ]}

                  activeKey={repositoryTab}
                  onChange={(key) => setRepositoryTab(key as RepositoryTab)}
                />

                {repositoryTab === "workspace" ? (
                  <div className="view-stack">
                    <TabBar
                      items={[
                        { key: "all", label: `全部 (${repositories.length})` },
                        ...groups.map((group) => ({ key: group, label: group }))
                      ]}
                      activeKey={repositoryGroupTab}
                      onChange={setRepositoryGroupTab}
                    />
                    <div className="inline-actions wrap">
                      {repositoryGroupTab !== "all" ? (
                        <button className="ghost-button" onClick={() => void handleSync(undefined, repositoryGroupTab)} disabled={busyAction === "sync"}>同步当前分组</button>
                      ) : null}
                      <button className="ghost-button" disabled>+ 新建分组</button>
                    </div>
                    <div className="repo-list">
                      {workspaceRepositories.map((repo) => {
                        const meta = getRepositoryMeta(repo, settings);
                        const compactStatusLabel = getCompactRepoStatusLabel(meta.label);
                        return (
                          <article key={repo.id} className="repo-item compact-row">
                            <div className="repo-main">
                              <div className="repo-title-row">
                                <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "repositories")} title={repo.path}>{repo.name}</button>
                              </div>
                              <div className="repo-meta-row">
                                <span className="repo-cell-ellipsis" title={`分组：${repo.group}`}>组 {repo.group}</span>
                                <span className="repo-cell-mono" title={`分支：${repo.status.currentBranch || "-"}`}>{repo.status.currentBranch || "-"}</span>
                                <span className="repo-cell-mono" title={`最近同步：${formatDateTime(repo.lastSyncAt)}`}>{formatCompactDateTime(repo.lastSyncAt)}</span>
                              </div>
                              <p className="muted repo-path-text" title={repo.path}>{repo.path}</p>
                            </div>
                            <div className="repo-side" title={meta.label}>
                              <Badge tone={meta.tone} text={compactStatusLabel} />
                            </div>
                          </article>
                        );
                      })}
                      {!workspaceRepositories.length ? <EmptyState title="该分组下暂无仓库" description="可以切换分组，或前往清单页导入新的仓库。" /> : null}
                    </div>

                  </div>
                ) : null}


                {repositoryTab === "list" ? (
                  <div className="view-stack">
                    <div className="filters-grid repo-list-filters">
                      <label className="search-box compact-search">
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 名称 / 路径 / 分支" />
                      </label>
                      <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                        <option value="all">全部组</option>
                        {groups.map((group) => <option key={group} value={group}>{group}</option>)}
                      </select>
                      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                        {statusFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                      <button className="ghost-button repo-compact-action" onClick={toggleSelectAllVisible}>{repositoryViewData.length && repositoryViewData.every((repo) => selectedRepoIds.includes(repo.id)) ? "取消全选" : "全选结果"}</button>
                      <button className="primary-button repo-compact-action" onClick={() => void handleSync(selectedRepoIds)} disabled={!selectedRepoIds.length || busyAction === "sync"}>同步 {selectedRepoIds.length ? `(${selectedRepoIds.length})` : ""}</button>
                    </div>
                    <div className="repo-table">
                      <div className="repo-table-row repo-table-head">
                        <span>仓库</span>
                        <span>组</span>
                        <span>分支</span>
                        <span>同步</span>
                        <span>结果</span>
                        <span>状态</span>
                      </div>
                      {repositoryViewData.map((repo) => {
                        const meta = getRepositoryMeta(repo, settings);
                        const compactStatusLabel = getCompactRepoStatusLabel(meta.label);
                        const isSelected = selectedRepoIds.includes(repo.id);
                        return (
                          <div key={repo.id} className="repo-table-row">
                            <div className="repo-table-name-cell">
                              <label className="check-wrap"><input type="checkbox" checked={isSelected} onChange={() => toggleRepoSelection(repo.id)} /></label>
                              <div className="repo-table-primary">
                                <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "repositories")} title={repo.path}>{repo.name}</button>
                                <span className="repo-table-secondary" title={repo.path}>{repo.path}</span>
                              </div>
                            </div>
                            <span className="repo-cell-ellipsis" title={repo.group}>{repo.group}</span>
                            <span className="repo-cell-mono" title={repo.status.currentBranch || "-"}>{repo.status.currentBranch || "-"}</span>
                            <span className="repo-cell-mono" title={formatDateTime(repo.lastSyncAt)}>{formatCompactDateTime(repo.lastSyncAt)}</span>
                            <span className="repo-cell-ellipsis" title={repo.lastSyncMessage || "-"}>{formatCompactSyncMessage(repo.lastSyncMessage)}</span>
                            <span title={meta.label}><Badge tone={meta.tone} text={compactStatusLabel} /></span>
                          </div>
                        );
                      })}
                    </div>

                    {!repositoryViewData.length ? <EmptyState title="未找到匹配结果" description="可以调整筛选条件，或先导入新的本地仓库。" /> : null}
                  </div>

                ) : null}

                {repositoryTab === "logs" ? (
                  <div className="view-stack">
                    <div className="task-log-toolbar">
                      <select value={selectedRepoId} onChange={(event) => setSelectedRepoId(event.target.value)}>
                        {repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
                      </select>
                      <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={!selectedRepo || busyAction === "export-repo-log"}>导出日志</button>
                    </div>
                    <div className="task-log-toolbar">
                      <label className="search-box compact-search">
                        <input value={repoLogSearch} onChange={(event) => setRepoLogSearch(event.target.value)} placeholder="搜索仓库日志、错误码" />
                      </label>
                      <select value={repoLogLevelFilter} onChange={(event) => setRepoLogLevelFilter(event.target.value as LogLevelFilter)}>
                        <option value="all">全部日志</option>
                        <option value="warning">仅警告</option>
                        <option value="error">仅错误</option>
                      </select>
                    </div>
                    <div className="log-line-list repo-log-list">
                      {filteredRepositoryLogLines.slice(0, 220).map((line) => (
                        <div key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                          <span className="log-line-index">#{line.index}</span>
                          <div className="log-line-badges">
                            <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                            {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                          </div>
                          <code className="log-line-text">{line.text}</code>
                        </div>
                      ))}
                      {!filteredRepositoryLogLines.length ? <EmptyState title="暂无日志记录" description="请选择仓库，或调整筛选条件。" /> : null}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {view === "tasks" && (
              <section className="card panel">
                <TabBar
                  items={[
                    { key: "overview", label: text.taskTabs.overview },
                    { key: "history", label: text.taskTabs.history },
                    { key: "detail", label: text.taskTabs.detail },
                    { key: "repoResults", label: text.taskTabs.repoResults },
                    { key: "logs", label: text.taskTabs.logs }
                  ]}

                  activeKey={taskTab}
                  onChange={(key) => setTaskTab(key as TaskTab)}
                />

                {taskTab === "overview" ? (
                  <div className="view-stack">
                    <section className="inset-card">
                      <div className="panel-header mini">
                        <div>
                          <h4>当前任务</h4>
                          <p className="muted">运行摘要已迁移到任务概览标签。</p>
                        </div>
                        {activeTask ? <Badge tone={toneFromTaskRecord(activeTask)} text={getTaskStatusLabel(activeTask)} /> : null}
                      </div>
                      {activeTask ? (
                        <>
                          <div className="progress-bar"><span style={{ width: `${syncProgress}%` }} /></div>
                          <p>{activeTask.summaryMessage}</p>
                          <div className="summary-row wrap">
                            <SummaryPill label="成功" value={activeTask.successCount} tone="success" />
                            <SummaryPill label="跳过" value={activeTask.skippedCount} tone="warning" />
                            <SummaryPill label="失败" value={activeTask.failedCount} tone="danger" />
                            {activeTask.cancelRequested || activeTask.cancelledCount > 0 ? (
                              <SummaryPill label="取消" value={activeTask.cancelledCount} tone="neutral" />
                            ) : null}
                          </div>
                          {activeTaskStatusHint ? <p className="helper">{activeTaskStatusHint}</p> : null}

                          <div className="stack-list compact-list">

                            {prioritizeTaskItems(activeTask.items).slice(0, 6).map((item) => (
                              <div key={`${item.repoId}-${item.finishedAt}`} className="list-item preview-item">
                                <div className="summary-row wrap">
                                  <button className="text-link-button" onClick={() => openRepoDetail(item.repoId, "tasks")}>{item.repoName}</button>
                                  <Badge tone={toneFromTaskState(item.state)} text={item.title} />
                                </div>
                                <p className="muted">{item.detail}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : latestTask ? (
                        <>
                          <div className="summary-row wrap">
                            <Badge tone={toneFromTaskRecord(latestTask)} text={getTaskStatusLabel(latestTask)} />
                            <span className="helper">{formatDateTime(latestTask.startTime)}</span>
                            <SummaryPill label="耗时" value={formatDuration(latestTask.items.reduce((sum, item) => sum + item.durationMs, 0))} tone="neutral" />
                          </div>
                          <p>{latestTask.summaryMessage}</p>
                          <div className="summary-row wrap">
                            <SummaryPill label="成功" value={latestTask.successCount} tone="success" />
                            <SummaryPill label="跳过" value={latestTask.skippedCount} tone="warning" />
                            <SummaryPill label="失败" value={latestTask.failedCount} tone="danger" />
                            {latestTask.cancelledCount > 0 ? <SummaryPill label="取消" value={latestTask.cancelledCount} tone="neutral" /> : null}
                          </div>
                        </>
                      ) : (
                        <EmptyState title="暂无任务记录" description="点击顶部“同步全部”后，这里会出现最近运行摘要。" />
                      )}
                      <div className="inline-actions wrap">
                        <button className="ghost-button" onClick={() => void handleCancelTask()} disabled={!activeTask?.running || activeTask.cancelRequested || busyAction === "cancel-task"}>
                          {activeTask?.cancelRequested ? "正在取消..." : "取消当前任务"}
                        </button>
                      </div>


                    </section>
                  </div>
                ) : null}

                {taskTab === "history" ? (
                  <div className="view-stack">
                    <div className="task-toolbar">
                      <label className="search-box compact-search">
                        <input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="搜索任务摘要、任务 ID、仓库名" />
                      </label>
                      <select value={taskResultFilter} onChange={(event) => setTaskResultFilter(event.target.value as TaskResultFilter)}>
                        <option value="all">全部结果</option>
                        <option value="failed">有失败</option>
                        <option value="warning">有跳过/取消</option>
                        <option value="success">全成功</option>
                      </select>
                      <input type="date" value={taskDateFilter} onChange={(event) => setTaskDateFilter(event.target.value)} />
                    </div>
                    <div className="stack-list">
                      {filteredTasks.map((task) => {
                        const taskStatusHint = task.taskId === activeTask?.taskId ? getTaskStatusHint(task, currentTaskRepoName) : getTaskStatusHint(task);
                        return (
                          <div
                            key={task.taskId}
                            className={`task-item interactive ${selectedTaskId === task.taskId ? "active" : ""}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openTaskDetail(task.taskId)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openTaskDetail(task.taskId);
                              }
                            }}
                          >
                            <div className="task-item-main">
                              <div className="task-item-head">
                                <strong>{getTaskModeLabel(task.mode)}</strong>
                                <Badge tone={toneFromTaskRecord(task)} text={getTaskStatusLabel(task)} />
                              </div>
                              <p className="muted">{formatDateTime(task.startTime)} · {task.summaryMessage}</p>
                              {taskStatusHint ? <p className="helper">{taskStatusHint}</p> : null}
                              <div className="task-item-meta">
                                <span>任务 ID：{task.taskId}</span>
                                <span>目标仓库：{task.total}</span>
                                <span>耗时：{formatDuration(task.items.reduce((sum, item) => sum + item.durationMs, 0))}</span>
                              </div>
                            </div>
                            <div className="task-item-side">
                              <div className="task-metrics">
                                <Badge tone="success" text={`成功 ${task.successCount}`} />
                                <Badge tone="warning" text={`跳过 ${task.skippedCount}`} />
                                <Badge tone="danger" text={`失败 ${task.failedCount}`} />
                                {task.cancelledCount > 0 ? <Badge tone="neutral" text={`取消 ${task.cancelledCount}`} /> : null}
                              </div>
                              {task.running ? (
                                <button
                                  className="ghost-button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleCancelTask(task.taskId);
                                  }}
                                  onKeyDown={(event) => event.stopPropagation()}
                                  disabled={task.cancelRequested || busyAction === "cancel-task"}
                                >
                                  {task.cancelRequested ? "取消中..." : "取消任务"}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}

                      {!filteredTasks.length ? <EmptyState title="暂无历史任务记录" description="可调整筛选条件，或执行一次新的同步任务。" /> : null}
                    </div>
                  </div>
                ) : null}

                {taskTab === "detail" ? (
                  <div className="view-stack">
                    {selectedTask ? (
                      <>
                        <div className="summary-row wrap">
                          <Badge tone={toneFromTaskRecord(selectedTask)} text={getTaskStatusLabel(selectedTask)} />
                          <SummaryPill label="成功" value={selectedTask.successCount} tone="success" />
                          <SummaryPill label="跳过" value={selectedTask.skippedCount} tone="warning" />
                          <SummaryPill label="失败" value={selectedTask.failedCount} tone="danger" />
                          {selectedTask.cancelledCount > 0 ? <SummaryPill label="取消" value={selectedTask.cancelledCount} tone="neutral" /> : null}
                          {selectedTask.running ? (
                            <button
                              className="ghost-button"
                              onClick={() => void handleCancelTask(selectedTask.taskId)}
                              disabled={selectedTask.cancelRequested || busyAction === "cancel-task"}
                            >
                              {selectedTask.cancelRequested ? "正在取消..." : "取消当前任务"}
                            </button>
                          ) : null}
                        </div>
                        {selectedTaskStatusHint ? <p className="helper">{selectedTaskStatusHint}</p> : null}

                        <div className="info-grid compact">

                          <InfoField label="任务模式" value={getTaskModeLabel(selectedTask.mode)} />
                          <InfoField label="开始时间" value={formatDateTime(selectedTask.startTime)} />
                          <InfoField label="结束时间" value={formatDateTime(selectedTask.endTime)} />
                          <InfoField label="日志文件" value={selectedTask.logFile || "-"} />
                        </div>
                        {taskCodeSummary.length ? <div className="task-code-list">{taskCodeSummary.map((item) => <Badge key={item.code} tone="danger" text={`${item.code} × ${item.count}`} />)}</div> : null}
                        <div className="stack-list compact-list">
                          {displayedTaskItems.map((item) => (
                            <div key={`${item.repoId}-${item.finishedAt}`} className="list-item task-result-item">
                              <div className="task-result-head">
                                <button className="text-link-button" onClick={() => openRepoDetail(item.repoId, "tasks")}>{item.repoName}</button>
                                <div className="summary-row wrap">
                                  <Badge tone={toneFromTaskState(item.state)} text={item.title} />
                                  {item.code ? <Badge tone={toneFromTaskState(item.state)} text={item.code} /> : null}
                                </div>
                              </div>
                              <p className="muted">{item.detail}</p>
                              <div className="repo-meta-row">
                                <span>{formatDateTime(item.finishedAt)}</span>
                                <span>{formatDuration(item.durationMs)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <EmptyState title="请选择一个任务" description="从历史任务进入后，这里会展示完整执行过程。" />
                    )}
                  </div>
                ) : null}

                {taskTab === "repoResults" ? (
                  <div className="view-stack">
                    <div className="stack-list compact-list">
                      {repositoryResultItems.map(({ repo, latestItem, runCount }) => (
                        <div key={repo.id} className="list-item task-result-item">
                          <div className="task-result-head">
                            <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "tasks")}>{repo.name}</button>
                            {latestItem ? <Badge tone={toneFromTaskState(latestItem.state)} text={latestItem.title} /> : null}
                          </div>
                          <div className="repo-meta-row">
                            <span>最近同步：{formatDateTime(latestItem?.finishedAt)}</span>
                            <span>累计任务：{runCount}</span>
                            <span>分组：{repo.group}</span>
                          </div>
                          <p className="muted">{latestItem?.detail || "暂无任务结果"}</p>
                        </div>
                      ))}
                      {!repositoryResultItems.length ? <EmptyState title="暂无仓库结果" description="任务完成后，将按仓库维度汇总最近执行结果。" /> : null}
                    </div>
                  </div>
                ) : null}

                {taskTab === "logs" ? (
                  <div className="view-stack">
                    <div className="task-log-toolbar">
                      <select value={selectedTaskId} onChange={(event) => setSelectedTaskId(event.target.value)}>
                        {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{formatDateTime(task.startTime)} · {getTaskModeLabel(task.mode)}</option>)}
                      </select>
                      <button className="ghost-button" onClick={() => void handleExportTaskLog()} disabled={!selectedTask || busyAction === "export-task-log"}>导出日志</button>
                    </div>
                    <div className="task-log-toolbar">
                      <label className="search-box compact-search">
                        <input value={taskLogSearch} onChange={(event) => setTaskLogSearch(event.target.value)} placeholder="搜索日志、仓库名、错误码" />
                      </label>
                      <select value={taskLogLevelFilter} onChange={(event) => setTaskLogLevelFilter(event.target.value as LogLevelFilter)}>
                        <option value="all">全部日志</option>
                        <option value="warning">仅警告</option>
                        <option value="error">仅错误</option>
                      </select>
                    </div>
                    <div className="summary-row wrap">
                      <SummaryPill label="总行数" value={parsedLogLines.length} tone="neutral" />
                      <SummaryPill label="当前结果" value={filteredLogLines.length} tone="pending" />
                      <SummaryPill label="错误行" value={filteredLogLines.filter((line) => line.level === "error").length} tone="danger" />
                    </div>
                    <div className="log-line-list">
                      {filteredLogLines.slice(0, 400).map((line) => (
                        <div key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                          <span className="log-line-index">#{line.index}</span>
                          <div className="log-line-badges">
                            <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                            {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                            {line.repoName ? <Badge tone="neutral" text={line.repoName} /> : null}
                          </div>
                          <code className="log-line-text">{line.text}</code>
                        </div>
                      ))}
                      {!filteredLogLines.length ? <EmptyState title="暂无日志记录" description="请选择任务或清空筛选条件后重试。" /> : null}
                    </div>
                  </div>
                ) : null}
              </section>
            )}

            {view === "settings" && (
              <section className="card panel">
                <TabBar

                  items={[
                    { key: "general", label: text.settingsTabs.general },
                    { key: "sync", label: text.settingsTabs.sync },
                    { key: "paths", label: text.settingsTabs.paths },
                    { key: "repositories", label: text.settingsTabs.repositories },
                    { key: "about", label: text.settingsTabs.about }
                  ]}

                  activeKey={settingsTab}
                  onChange={(key) => setSettingsTab(key as SettingsTab)}
                />

                {settingsTab === "general" ? (
                  <div className="settings-tab-content">
                    <div className="form-grid two-columns">
                      <label>
                        <span>{text.settings.defaultView}</span>
                        <select value={settings.defaultView} onChange={(event) => setSettings((current) => ({ ...current, defaultView: normalizePreferredView(event.target.value as PreferredView) }))}>
                          <option value="overview">{text.nav.overview}</option>
                          <option value="repositories">{text.nav.repositories}</option>
                          <option value="tasks">{text.nav.tasks}</option>
                          <option value="settings">{text.nav.settings}</option>
                        </select>
                      </label>
                      <label>
                        <span>{text.settings.theme}</span>
                        <select value={settings.themeMode} onChange={(event) => setSettings((current) => ({ ...current, themeMode: normalizeThemeMode(event.target.value as ThemeMode) }))}>
                          <option value="system">{text.settings.themeSystem}</option>
                          <option value="light">{text.settings.themeLight}</option>
                          <option value="dark">{text.settings.themeDark}</option>
                        </select>
                      </label>
                      <label>
                        <span>{text.settings.windowClose}</span>
                        <select disabled>
                          <option>{text.settings.closeFixed}</option>
                        </select>
                      </label>

                      <label className="switch-row">
                        <input type="checkbox" checked readOnly />
                        <span>{text.settings.autoRefresh}</span>
                      </label>
                      <label>
                        <span>{text.settings.language}</span>
                        <select value={settings.languageMode} onChange={(event) => setSettings((current) => ({ ...current, languageMode: normalizeLanguageMode(event.target.value as LanguageMode) }))}>
                          <option value="zh-CN">{text.settings.langZh}</option>
                          <option value="en-US">{text.settings.langEn}</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ) : null}


                {settingsTab === "sync" ? (
                  <div className="settings-tab-content">
                    <div className="form-grid two-columns">
                      <label>
                        <span>同步模式</span>
                        <input value="Safe" readOnly />
                      </label>
                      <label>
                        <span>并发数</span>
                        <input type="number" min={1} max={5} value={settings.concurrentLimit} onChange={(event) => setSettings((current) => ({ ...current, concurrentLimit: Number(event.target.value) || 1 }))} />
                      </label>
                      <label>
                        <span>命令超时（秒）</span>
                        <input type="number" min={10} max={300} value={settings.commandTimeoutSecs} onChange={(event) => setSettings((current) => ({ ...current, commandTimeoutSecs: Number(event.target.value) || 10 }))} />
                      </label>
                      <label className="switch-row">
                        <input type="checkbox" checked={settings.skipUntrackedFiles} onChange={(event) => setSettings((current) => ({ ...current, skipUntrackedFiles: event.target.checked }))} />
                        <span>跳过未跟踪文件</span>
                      </label>
                      <label className="switch-row">
                        <input type="checkbox" disabled />
                        <span>自动重试瞬时失败（待接入）</span>
                      </label>
                    </div>
                  </div>
                ) : null}

                {settingsTab === "paths" ? (
                  <div className="settings-tab-content">
                    <div className="info-grid compact">
                      <InfoField label="配置目录" value={configDirectory || "-"} />
                      <InfoField label="当前日志目录" value={logsDiagnostics.directory || logsDirectory || "-"} />
                      <InfoField label="默认扫描目录" value={settings.defaultScanRoot || "-"} />
                    </div>
                    <section className="inset-card">
                      <div className="panel-header mini"><div><h4>配置目录</h4><p className="muted">修改后建议重启应用，确保全部路径切换生效。</p></div></div>
                      <div className="inline-actions wrap">
                        <button className="ghost-button" onClick={() => void api.openExternal(configDirectory)} disabled={!configDirectory || busyAction === "config-directory"}>打开目录</button>
                        <button className="ghost-button" onClick={() => void handleChangeConfigDirectory()} disabled={busyAction === "config-directory"}>修改目录</button>
                        <button className="ghost-button" onClick={() => void handleResetConfigDirectory()} disabled={busyAction === "config-directory"}>恢复默认</button>
                      </div>
                    </section>
                    <section className="inset-card">
                      <div className="panel-header mini"><div><h4>日志目录</h4><p className="muted">后续新日志写入新目录，历史日志不自动迁移。</p></div></div>
                      <div className="path-input">
                        <input value={settings.logsDirectory ?? ""} onChange={(event) => setSettings((current) => ({ ...current, logsDirectory: event.target.value }))} placeholder="例如 D:/SyncDockLogs" />
                        <button type="button" className="ghost-button" onClick={() => void pickFolder((value) => setSettings((current) => ({ ...current, logsDirectory: value })))}>修改目录</button>
                      </div>
                      <div className="inline-actions wrap">
                        <button className="ghost-button" onClick={() => void api.openExternal(logsDirectory)} disabled={!logsDirectory}>打开目录</button>
                        <button className="ghost-button" onClick={handleResetLogsDirectory}>恢复默认</button>
                        <button className="ghost-button" onClick={() => void handleCleanupLogs()} disabled={busyAction === "cleanup-logs"}>清理日志</button>
                      </div>
                    </section>
                    <section className="inset-card">
                      <div className="panel-header mini"><div><h4>默认扫描目录</h4></div></div>
                      <div className="path-input">
                        <input value={settings.defaultScanRoot ?? ""} onChange={(event) => setSettings((current) => ({ ...current, defaultScanRoot: event.target.value }))} placeholder="例如 D:/Code" />
                        <button type="button" className="ghost-button" onClick={() => void pickFolder((value) => setSettings((current) => ({ ...current, defaultScanRoot: value })))}>修改目录</button>
                      </div>
                      <div className="inline-actions wrap">
                        <button className="ghost-button" onClick={() => void api.openExternal(settings.defaultScanRoot ?? "")} disabled={!settings.defaultScanRoot}>打开目录</button>
                        <button className="ghost-button" onClick={() => setSettings((current) => ({ ...current, defaultScanRoot: "" }))} disabled={!settings.defaultScanRoot}>恢复默认</button>
                      </div>
                    </section>
                    <div className="form-grid two-columns">
                      <label>
                        <span>日志保留天数</span>
                        <select
                          value={String(settings.logRetentionDays)}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setSettings((current) => ({ ...current, logRetentionDays: Number.isNaN(nextValue) ? 30 : nextValue }));
                          }}
                        >
                          <option value="7">7 天</option>
                          <option value="15">15 天</option>
                          <option value="30">30 天</option>
                          <option value="60">60 天</option>
                          <option value="90">90 天</option>
                          <option value="0">永久</option>
                        </select>
                      </label>

                      <label className="switch-row">
                        <input type="checkbox" checked={settings.showDebugLogs} onChange={(event) => setSettings((current) => ({ ...current, showDebugLogs: event.target.checked }))} />
                        <span>保留调试日志</span>
                      </label>
                    </div>
                  </div>
                ) : null}

                {settingsTab === "repositories" ? (
                  <div className="settings-tab-content">
                    <div className="form-grid two-columns">
                      <label className="full-span">
                        <span>忽略目录（逗号分隔）</span>
                        <input value={settings.ignoredDirectories.join(", ")} onChange={(event) => setSettings((current) => ({ ...current, ignoredDirectories: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} />
                      </label>
                      <label>
                        <span>扫描深度</span>
                        <input type="number" min={1} max={12} value={settings.scanDepth} onChange={(event) => setSettings((current) => ({ ...current, scanDepth: Number(event.target.value) || 4 }))} />
                      </label>
                    </div>
                    <div className="inline-actions wrap">
                      <button className="ghost-button" onClick={() => void handleExportConfig()} disabled={busyAction === "export-config"}>导出仓库配置</button>
                      <button className="ghost-button" onClick={() => void handleSelectImportConfig()} disabled={busyAction === "preview-config" || busyAction === "import-config"}>导入仓库配置</button>
                    </div>
                  </div>
                ) : null}

                {settingsTab === "about" ? (
                  <div className="settings-tab-content">
                    <div className="panel-grid two-columns">
                      <section className="inset-card">
                        <div className="panel-header mini"><div><h4>应用信息</h4><p className="muted">关于页承接配置目录与诊断入口。</p></div></div>
                        <div className="info-grid compact">
                          <InfoField label="版本号" value="0.1.0" />
                          <InfoField label="Git 环境" value={gitEnvironment.available ? "可用" : "不可用"} />
                          <InfoField label="Git 版本" value={gitEnvironment.version || "-"} />
                          <InfoField label="配置目录" value={configDirectory || "-"} />
                        </div>
                        <div className="inline-actions wrap">
                          <button className="ghost-button" onClick={() => void api.openExternal(configDirectory)} disabled={!configDirectory}>打开配置目录</button>
                          <button className="ghost-button" onClick={() => void handleExportConfig()} disabled={busyAction === "export-config"}>导出诊断配置</button>
                        </div>
                      </section>
                      <section className="inset-card">
                        <div className="panel-header mini"><div><h4>日志与环境</h4></div></div>
                        <div className="info-grid compact">
                          <InfoField label="日志目录" value={logsDirectory || "-"} />
                          <InfoField label="日志文件数" value={String(logsDiagnostics.fileCount)} />
                          <InfoField label="占用空间" value={formatBytes(logsDiagnostics.totalSizeBytes)} />
                          <InfoField label="Git 说明" value={gitEnvironment.message} />
                        </div>
                      </section>
                    </div>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        )}

      </main>

      <Modal open={importModalOpen} title="导入配置包" onClose={closeImportModal}>
        <div className="settings-tab-content">
          <section className="inset-card">
            <div className="panel-header mini">
              <div>
                <h4>导入文件</h4>
                <p className="muted">先做预检查，再决定导入策略、冲突处理和路径迁移规则</p>
              </div>
              <button className="ghost-button" onClick={() => void handleSelectImportConfig()} disabled={busyAction === "preview-config" || busyAction === "import-config"}>
                重新选择文件
              </button>
            </div>
            <div className="info-grid compact">
              <InfoField label="文件路径" value={importSourcePath || "-"} />
              <InfoField label="包版本" value={importPreview ? `v${importPreview.version}` : "-"} />
              <InfoField label="导出时间" value={formatDateTime(importPreview?.exportedAt)} />
            </div>
            <p className="helper">导入前会自动备份当前配置；若日志目录在当前设备不可用，将跳过该目录但继续导入其他内容。</p>
          </section>

          {importPreview ? (
            <>
              <div className="summary-row wrap">
                <SummaryPill label="仓库" value={importPreview.repositoryCount} tone="neutral" />
                <SummaryPill label="任务摘要" value={importPreview.taskCount} tone="pending" />
                <SummaryPill label="冲突项" value={importPreview.repoConflicts.length} tone={importPreview.repoConflicts.length ? "warning" : "success"} />
                <SummaryPill label="失效路径" value={importPreview.invalidRepoPaths.length} tone={importPreview.invalidRepoPaths.length ? "warning" : "success"} />
              </div>

              <section className="inset-card">
                <div className="panel-header mini">
                  <div>
                    <h4>导入策略</h4>
                    <p className="muted">{getImportStrategyDescription(importStrategy)}</p>
                  </div>
                </div>
                <div className="form-grid two-columns">
                  <label>
                    <span>导入方式</span>
                    <select value={importStrategy} onChange={(event) => setImportStrategy(event.target.value as ImportStrategy)}>
                      <option value="merge">{getImportStrategyLabel("merge")}</option>
                      <option value="overwrite">{getImportStrategyLabel("overwrite")}</option>
                      <option value="repositoriesOnly">{getImportStrategyLabel("repositoriesOnly")}</option>
                      <option value="settingsOnly">{getImportStrategyLabel("settingsOnly")}</option>
                    </select>
                  </label>
                  <label className="switch-row">
                    <input type="checkbox" checked={importSkipConflicts} onChange={(event) => setImportSkipConflicts(event.target.checked)} disabled={!canSkipImportConflicts} />
                    <span>遇到路径冲突时跳过现有仓库（更安全）</span>
                  </label>
                </div>
                {!canSkipImportConflicts ? <p className="helper">当前策略不会使用“跳过冲突”选项。</p> : null}
              </section>

              <section className="inset-card">
                <div className="panel-header mini">
                  <div>
                    <h4>路径迁移辅助</h4>
                    <p className="muted">适合从另一台电脑导入，例如将 `D:/Code` 批量替换为 `E:/Work`</p>
                  </div>
                  <button className="ghost-button" onClick={() => setImportPathReplacements((current) => [...current, { from: "", to: "" }])}>
                    新增规则
                  </button>
                </div>
                <div className="stack-list compact-list">
                  {importPathReplacements.map((item, index) => (
                    <div key={`replacement-${index}`} className="list-item path-replacement-row">
                      <input
                        value={item.from}
                        onChange={(event) => setImportPathReplacements((current) => current.map((currentItem, currentIndex) => currentIndex === index ? { ...currentItem, from: event.target.value } : currentItem))}
                        placeholder="原路径前缀，例如 D:/Code"
                      />
                      <input
                        value={item.to}
                        onChange={(event) => setImportPathReplacements((current) => current.map((currentItem, currentIndex) => currentIndex === index ? { ...currentItem, to: event.target.value } : currentItem))}
                        placeholder="新路径前缀，例如 E:/Work"
                      />
                      <button className="ghost-button" onClick={() => setImportPathReplacements((current) => current.length === 1 ? [{ from: "", to: "" }] : current.filter((_, currentIndex) => currentIndex !== index))}>
                        移除
                      </button>
                    </div>
                  ))}
                </div>
                <p className="helper">当前有效替换规则 {normalizedImportPathReplacements.length} 条，仅在本次导入执行时生效。</p>
              </section>

              <div className="panel-grid two-columns">
                <section className="inset-card">
                  <div className="panel-header mini">
                    <div>
                      <h4>预检查摘要</h4>
                      <p className="muted">确认冲突、设置变化和日志目录状态</p>
                    </div>
                  </div>
                  <div className="info-grid compact">
                    <InfoField label="日志目录" value={getLogsDirectoryStatusLabel(importPreview.logsDirectoryStatus, importPreview.logsDirectory)} />
                    <InfoField label="设置变更项" value={String(importPreview.settingsChanges.length)} />
                    <InfoField label="仓库冲突" value={String(importPreview.repoConflicts.length)} />
                    <InfoField label="待处理路径" value={String(importPreview.invalidRepoPaths.length)} />
                    <InfoField label="风险提示" value={String(importPreview.warnings.length)} />
                  </div>

                </section>

                <section className="inset-card">
                  <div className="panel-header mini">
                    <div>
                      <h4>本次将写入</h4>
                      <p className="muted">确认当前策略会更新哪些数据</p>
                    </div>
                  </div>
                  <div className="summary-row wrap">
                    <Badge tone={importStrategy === "repositoriesOnly" ? "neutral" : "pending"} text={`设置${importStrategy === "repositoriesOnly" ? " · 跳过" : ""}`} />
                    <Badge tone={importStrategy === "settingsOnly" ? "neutral" : "pending"} text={`仓库${importStrategy === "settingsOnly" ? " · 跳过" : ""}`} />
                    <Badge tone={importStrategy === "merge" || importStrategy === "overwrite" ? "pending" : "neutral"} text={`任务摘要${importStrategy === "merge" || importStrategy === "overwrite" ? "" : " · 跳过"}`} />
                  </div>
                  <p className="helper">{importPreview.logsDirectoryStatus === "invalid" ? "包内日志目录在当前设备不可用，导入时会自动跳过该项。" : "建议先看清仓库冲突与无效路径，再执行导入。"}</p>
                </section>
              </div>

              {importPreview.logsDirectoryStatus === "invalid" ? (
                <div className="notice warning">检测到包内日志目录不可用：{importPreview.logsDirectory || "未提供"}。导入时会自动保留当前设备上的日志目录配置。</div>
              ) : importPreview.logsDirectoryStatus === "ok" ? (
                <div className="notice success">包内日志目录可用：{importPreview.logsDirectory}</div>
              ) : (
                <div className="notice success">包内未包含自定义日志目录，将继续使用当前设备的默认或现有目录。</div>
              )}

              <section className="inset-card">
                <div className="panel-header mini">
                  <div>
                    <h4>预检查风险提示</h4>
                    <p className="muted">以下提示已对齐 V2 错误码规范，可用于确认导入前风险</p>
                  </div>
                </div>
                <InlineNoticeList notices={importPreview.warnings} emptyTitle="当前没有额外风险提示" emptyDescription="未检测到冲突或失效路径，可按当前策略继续导入。" />
              </section>

              <div className="panel-grid two-columns">

                <section className="inset-card">
                  <div className="panel-header mini">
                    <div>
                      <h4>设置变更预览</h4>
                      <p className="muted">仅列出与当前设备不同的设置键</p>
                    </div>
                  </div>
                  {importPreview.settingsChanges.length ? (
                    <div className="task-code-list">
                      {importPreview.settingsChanges.map((key) => <Badge key={key} tone="neutral" text={key} />)}
                    </div>
                  ) : (
                    <EmptyState title="没有检测到设置差异" description="当前配置与导入包中的设置项基本一致。" />
                  )}
                </section>

                <section className="inset-card">
                  <div className="panel-header mini">
                    <div>
                      <h4>仓库冲突预览</h4>
                      <p className="muted">规范化路径一致的仓库会在这里提示</p>
                    </div>
                  </div>
                  {importPreview.repoConflicts.length ? (
                    <div className="stack-list compact-list modal-list">
                      {importPreview.repoConflicts.map((conflict) => (
                        <div key={`${conflict.path}-${conflict.incomingName}`} className="list-item preview-item">
                          <strong>{conflict.path}</strong>
                          <p className="muted">当前：{conflict.existingName} / {conflict.existingGroup || "未分组"}</p>
                          <p className="muted">导入：{conflict.incomingName} / {conflict.incomingGroup || "未分组"}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="没有仓库冲突" description="当前导入包中的仓库路径与本机记录没有重复。" />
                  )}
                </section>
              </div>

              <section className="inset-card">
                <div className="panel-header mini">
                  <div>
                    <h4>需重新定位的仓库路径</h4>
                    <p className="muted">可先增加路径前缀替换规则，再执行导入</p>
                  </div>
                </div>
                {importPreview.invalidRepoPaths.length ? (
                  <div className="stack-list compact-list modal-list">
                    {importPreview.invalidRepoPaths.map((path) => (
                      <div key={path} className="list-item preview-item">
                        <strong>{path}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="没有检测到失效路径" description="导入包中的仓库路径在当前设备上均可访问。" />
                )}
              </section>

              {importResult ? (
                <section className="inset-card">
                  <div className="panel-header mini">
                    <div>
                      <h4>导入结果</h4>
                      <p className="muted">导入成功后，可根据备份目录和待处理项继续收尾</p>
                    </div>
                  </div>
                  <div className="info-grid compact">
                    <InfoField label="应用策略" value={getImportStrategyLabel(importResult.appliedStrategy)} />
                    <InfoField label="备份目录" value={importResult.backupDirectory} />
                    <InfoField label="导入仓库数" value={String(importResult.repositoryCount)} />
                    <InfoField label="导入任务摘要" value={String(importResult.taskCount)} />
                    <InfoField label="冲突数" value={String(importResult.conflictCount)} />
                    <InfoField label="路径替换数" value={String(importResult.replacedPathCount)} />
                    <InfoField label="警告数" value={String(importResult.warnings.length)} />
                  </div>

                  {importResult.skippedLogsDirectory ? (
                    <div className="notice warning">已跳过不可用日志目录：{importResult.skippedLogsDirectory}</div>
                  ) : null}
                  {importResult.warnings.length ? (
                    <div className="import-result-warning-block">
                      <InlineNoticeList notices={importResult.warnings} emptyTitle="" emptyDescription="" />
                    </div>
                  ) : null}
                  {importResult.invalidRepoPaths.length ? (
                    <div className="stack-list compact-list modal-list">
                      {importResult.invalidRepoPaths.map((path) => (
                        <div key={path} className="list-item preview-item">
                          <strong>{path}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

              ) : null}
            </>
          ) : (
            <EmptyState title="尚未选择配置包" description="请选择之前导出的 JSON 配置包，系统会先执行预检查。" />
          )}
        </div>
        <div className="modal-footer wrap">
          <button className="ghost-button" onClick={closeImportModal}>关闭</button>
          <button className="primary-button" onClick={() => void handleImportConfig()} disabled={!importPreview || busyAction === "preview-config" || busyAction === "import-config"}>
            {busyAction === "import-config" ? "正在导入..." : "执行导入"}
          </button>
        </div>
      </Modal>

      <Modal open={scanModalOpen} title="扫描本地目录" onClose={() => setScanModalOpen(false)}>

        <div className="form-grid">
          <label className="full-span">
            <span>扫描根目录</span>
            <div className="path-input">
              <input value={scanRootPath} onChange={(event) => setScanRootPath(event.target.value)} placeholder="选择要递归扫描的目录" />
              <button type="button" className="ghost-button" onClick={() => void pickFolder(setScanRootPath)}>选择</button>
            </div>
          </label>
          <label>
            <span>扫描深度</span>
            <input type="number" min={1} max={12} value={scanDepth} onChange={(event) => setScanDepth(Number(event.target.value) || 4)} />
          </label>
        </div>
        <div className="inline-actions wrap">
          <button className="primary-button" onClick={() => void handleScanRepositories()} disabled={busyAction === "scan"}>{busyAction === "scan" ? "扫描中..." : "开始扫描"}</button>
          <button className="ghost-button" onClick={() => setScanResults((current) => current.map((repo) => ({ ...repo, selected: true })))} disabled={!scanResults.length}>全选</button>
          <button className="ghost-button" onClick={() => setScanResults((current) => current.map((repo) => ({ ...repo, selected: false })))} disabled={!scanResults.length}>清空</button>
        </div>
        <div className="stack-list compact-list modal-list">
          {scanResults.map((repo, index) => (
            <div key={`${repo.path}-${index}`} className="list-item scan-result-item">
              <div className="scan-result-header">
                <label className="summary-row">
                  <input type="checkbox" checked={repo.selected} onChange={() => updateScanResult(index, (current) => ({ ...current, selected: !current.selected }))} />
                  <strong>{repo.name || getPathLeafName(repo.path)}</strong>
                </label>
                <Badge tone="neutral" text={repo.currentBranch || "未识别分支"} />
              </div>
              <p className="muted">{repo.path}</p>
              <div className="form-grid two-columns scan-result-form">
                <label>
                  <span>名称</span>
                  <input value={repo.name} onChange={(event) => updateScanResult(index, (current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label>
                  <span>分组</span>
                  <input value={repo.group} onChange={(event) => updateScanResult(index, (current) => ({ ...current, group: event.target.value }))} />
                </label>
              </div>
              <div className="repo-meta-row">
                <span>分支：{repo.currentBranch || "-"}</span>
                {repo.remoteUrl ? <span>远端：{repo.remoteUrl}</span> : null}
                <span>识别结果：{repo.status || "已识别 Git 仓库"}</span>
              </div>
            </div>
          ))}
          {!scanResults.length ? <EmptyState title="尚未开始扫描" description="选择目录后开始扫描，识别到的仓库会逐条列出并允许修改名称与分组。" /> : null}
        </div>
        <div className="modal-footer">
          <button className="primary-button" onClick={() => void handleImportScannedRepositories()} disabled={!scanResults.some((repo) => repo.selected) || busyAction === "import"}>
            {busyAction === "import" ? "正在导入..." : "导入选中仓库"}
          </button>
        </div>
      </Modal>


      <Modal open={addModalOpen} title="手动添加本地仓库" onClose={() => setAddModalOpen(false)}>
        <div className="form-grid">
          <label className="full-span">
            <span>仓库路径</span>
            <div className="path-input">
              <input value={draftRepo.path ?? ""} onChange={(event) => setDraftRepo((current) => ({ ...current, path: event.target.value }))} placeholder="例如 D:/Code/MyRepo" />
              <button type="button" className="ghost-button" onClick={() => void pickFolder((value) => setDraftRepo((current) => ({ ...current, path: value })))}>选择</button>
            </div>
          </label>
          <label>
            <span>显示名称</span>
            <input value={draftRepo.name ?? ""} onChange={(event) => setDraftRepo((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            <span>分组</span>
            <input value={draftRepo.group ?? ""} onChange={(event) => setDraftRepo((current) => ({ ...current, group: event.target.value }))} />
          </label>
          <label className="full-span">
            <span>备注</span>
            <textarea rows={3} value={draftRepo.note ?? ""} onChange={(event) => setDraftRepo((current) => ({ ...current, note: event.target.value }))} />
          </label>
        </div>
        <div className="modal-footer"><button className="primary-button" onClick={() => void handleAddRepository()}>添加仓库</button></div>
      </Modal>

      <Modal open={cloneModalOpen} title="可视化 Clone 仓库" onClose={() => setCloneModalOpen(false)}>
        <div className="form-grid">
          <label className="full-span">
            <span>远端地址</span>
            <input value={cloneDraft.remoteUrl} onChange={(event) => setCloneDraft((current) => ({ ...current, remoteUrl: event.target.value }))} placeholder="支持 HTTPS / SSH Git 地址" />
          </label>
          <label className="full-span">
            <span>目标父目录</span>
            <div className="path-input">
              <input value={cloneDraft.destinationParent} onChange={(event) => setCloneDraft((current) => ({ ...current, destinationParent: event.target.value }))} placeholder="选择 clone 的父级目录" />
              <button type="button" className="ghost-button" onClick={() => void pickFolder((value) => setCloneDraft((current) => ({ ...current, destinationParent: value })))}>选择</button>
            </div>
          </label>
          <label>
            <span>目录名（可选）</span>
            <input value={cloneDraft.directoryName ?? ""} onChange={(event) => setCloneDraft((current) => ({ ...current, directoryName: event.target.value }))} />
          </label>
          <label>
            <span>分组</span>
            <input value={cloneDraft.group ?? ""} onChange={(event) => setCloneDraft((current) => ({ ...current, group: event.target.value }))} />
          </label>
          <label className="full-span">
            <span>备注</span>
            <textarea rows={3} value={cloneDraft.note ?? ""} onChange={(event) => setCloneDraft((current) => ({ ...current, note: event.target.value }))} />
          </label>
        </div>
        <div className="modal-footer"><button className="primary-button" onClick={() => void handleCloneRepository()}>开始 Clone</button></div>
      </Modal>
    </div>
  );
}

function matchesOverviewStatusFilter(repo: RepositoryRecord, filter: OverviewStatusFilter, settings: AppSettings) {
  if (filter === "all") {
    return true;
  }

  const meta = getRepositoryMeta(repo, settings);
  if (filter === "pending") {
    return repo.status.syncRequired;
  }
  if (filter === "failed") {
    return meta.tone === "danger";
  }
  if (filter === "warning") {
    return meta.tone === "warning" || repo.lastSyncStatus === "skipped";
  }
  if (filter === "success") {
    return meta.tone === "success";
  }
  return true;
}

function getRepositoryMeta(repo: RepositoryRecord, settings: AppSettings): { tone: RepoTone; label: string } {
  if (!repo.enabled) {
    return { tone: "neutral", label: "已禁用" };
  }

  if (!repo.status.repoHealthy) {
    return { tone: "danger", label: "仓库异常" };
  }
  if (repo.lastSyncStatus === "failed") {
    return { tone: "danger", label: "同步失败" };
  }
  if (repo.status.inProgressOperation) {
    return { tone: "warning", label: "处理中断" };
  }
  if (repo.status.detachedHead) {
    return { tone: "warning", label: "Detached HEAD" };
  }
  if (repo.status.hasUncommittedChanges) {
    return { tone: "warning", label: "本地有改动" };
  }
  if (settings.skipUntrackedFiles && repo.status.hasUntrackedFiles) {
    return { tone: "warning", label: "未跟踪文件" };
  }
  if (!repo.status.upstreamConfigured) {
    return { tone: "warning", label: "未配置 upstream" };
  }
  if (repo.status.syncRequired) {
    return { tone: "pending", label: `待同步 · behind ${repo.status.behindCount}` };
  }
  if (repo.lastSyncStatus === "cancelled") {
    return { tone: "neutral", label: "已取消" };
  }
  if (repo.lastSyncStatus === "skipped") {
    return { tone: "warning", label: "已跳过" };
  }
  if (repo.lastSyncStatus === "success") {
    return { tone: "success", label: "已同步" };
  }
  return { tone: "success", label: "状态正常" };
}


function mergeTasks(tasks: SyncTaskRecord[], next: SyncTaskRecord): SyncTaskRecord[] {
  return [next, ...tasks.filter((task) => task.taskId !== next.taskId)].sort((a, b) => b.startTime.localeCompare(a.startTime));
}

function sortRepositories(repositories: RepositoryRecord[]) {
  return [...repositories].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

function normalizeScannedRepositories(repositories: ScannedRepository[]) {
  return repositories.map((repo) => ({
    ...repo,
    name: repo.name.trim() || getPathLeafName(repo.path),
    group: repo.group.trim() || "未分组"
  }));
}

function getPathLeafName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "未命名仓库";
}

function toneFromTaskState(state: string): RepoTone {

  if (state === "success") return "success";
  if (state === "skipped") return "warning";
  if (state === "failed") return "danger";
  if (state === "cancelled") return "neutral";
  return "neutral";
}

function toneFromTaskRecord(task: SyncTaskRecord): RepoTone {
  if (task.running && task.cancelRequested) return "warning";
  if (task.running) return "pending";
  if (task.cancelled) return "neutral";
  if (task.failedCount > 0) return "danger";
  if (task.skippedCount > 0) return "warning";
  if (task.successCount > 0) return "success";
  return "neutral";
}

function toneFromLogLevel(level: ParsedLogLine["level"]): RepoTone {

  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  return "neutral";
}

function getTaskModeLabel(mode: string) {
  return mode === "all" ? "同步全部" : mode === "group" ? "分组同步" : "选中同步";
}

function getTaskStatusLabel(task: SyncTaskRecord) {
  if (task.running && task.cancelRequested) return "取消中";
  if (task.running) return "运行中";
  if (task.cancelled) return "已取消";
  if (task.failedCount === task.total && task.total > 0) return "全部失败";
  if (task.failedCount > 0) return "部分失败";
  return "已完成";
}

function getTaskStatusHint(task: SyncTaskRecord, currentRepoName?: string) {
  if (task.running && task.cancelRequested) {
    return currentRepoName
      ? `已请求取消，正在等待仓库 ${currentRepoName} 停止。`
      : "已请求取消，正在等待当前 Git 命令退出。";
  }
  if (task.running) {
    return currentRepoName ? `当前执行仓库：${currentRepoName}` : "任务正在执行中。";
  }
  if (task.cancelled) {
    return task.cancelledCount > 0
      ? `该任务已取消，已有 ${task.cancelledCount} 个仓库被标记为“已取消”。`
      : "该任务已取消。";
  }
  return "";
}

function buildTaskSummary(task: SyncTaskRecord) {

  const header = [
    `任务 ID：${task.taskId}`,
    `任务模式：${getTaskModeLabel(task.mode)}`,
    `任务状态：${getTaskStatusLabel(task)}`,
    `开始时间：${formatDateTime(task.startTime)}`,
    `结束时间：${formatDateTime(task.endTime)}`,
    `摘要：${task.summaryMessage}`
  ];

  const items = prioritizeTaskItems(task.items).map((item) => {
    const code = item.code ? ` · ${item.code}` : "";
    return `${item.repoName} · ${item.title}${code} · ${item.detail}`;
  });

  return [...header, "", ...items].join("\n");
}

function aggregateTaskCodes(items: SyncTaskItemResult[]) {
  const counter = new Map<string, number>();
  items.forEach((item) => {
    if (!item.code) return;
    counter.set(item.code, (counter.get(item.code) ?? 0) + 1);
  });
  return [...counter.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function prioritizeTaskItems(items: SyncTaskItemResult[]) {
  const rank = (item: SyncTaskItemResult) => {
    if (item.state === "failed") return 0;
    if (item.state === "cancelled") return 1;
    if (item.state === "skipped") return 2;
    if (item.state === "success") return 3;
    return 4;
  };


  return [...items].sort((left, right) => {
    const diff = rank(left) - rank(right);
    if (diff !== 0) return diff;
    return right.finishedAt.localeCompare(left.finishedAt);
  });
}

function parseTaskLog(log: string): ParsedLogLine[] {
  if (!log.trim()) {
    return [];
  }

  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const repoMatch = line.match(/\[[^\]]+\]\[([^\]]+)\]/);
      const codeMatch = line.match(/SD-[A-Z]+-\d+/);
      return {
        index: index + 1,
        text: line,
        level: inferLogLevel(line),
        repoName: repoMatch?.[1] ?? null,
        code: codeMatch?.[0] ?? null
      };
    });
}

function inferLogLevel(line: string): ParsedLogLine["level"] {
  const text = line.toLowerCase();
  if (text.includes("fatal") || text.includes("error") || text.includes("failed") || text.includes("失败")) {
    return "error";
  }
  if (text.includes("warning") || text.includes("warn") || text.includes("跳过") || text.includes("skipped")) {
    return "warning";
  }
  return "info";
}

function normalizePreferredView(view?: PreferredView | string | null): ViewKey {
  return view === "repositories" || view === "tasks" || view === "settings" ? view : "overview";
}

function normalizeThemeMode(mode?: ThemeMode | string | null): ThemeMode {
  return mode === "light" || mode === "dark" ? mode : "system";
}

function normalizeLanguageMode(mode?: LanguageMode | string | null): LanguageMode {
  return mode === "en-US" ? mode : "zh-CN";
}

function getImportStrategyLabel(strategy: ImportStrategy) {


  return {
    merge: "合并导入",
    overwrite: "整体覆盖",
    repositoriesOnly: "仅导入仓库",
    settingsOnly: "仅导入设置"
  }[strategy];
}

function getImportStrategyDescription(strategy: ImportStrategy) {
  return {
    merge: "合并当前配置与导入包，适合日常迁移；任务摘要也会一并合并。",
    overwrite: "使用导入包整体替换当前设置、仓库与任务摘要，适合完整恢复。",
    repositoriesOnly: "只导入仓库清单，保留当前设备上的设置与任务摘要。",
    settingsOnly: "只导入应用设置，仓库列表与任务摘要保持不变。"
  }[strategy];
}

function getLogsDirectoryStatusLabel(status: ConfigImportPreview["logsDirectoryStatus"], directory?: string | null) {
  if (status === "ok") {
    return directory ? `可用 · ${directory}` : "可用";
  }
  if (status === "invalid") {
    return directory ? `不可用 · ${directory}` : "不可用";
  }
  return "未包含自定义日志目录";
}

function formatDateTime(value?: string | null) {

  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatCompactDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(/\//g, "-");
}

function getCompactRepoStatusLabel(label: string) {
  const pendingMatch = label.match(/^待同步\s*[·•]?\s*behind\s+(\d+)$/i);
  if (pendingMatch) {
    return `待同步 ${pendingMatch[1]}`;
  }
  const labelMap: Record<string, string> = {
    仓库异常: "异常",
    同步失败: "失败",
    处理中断: "中断",
    "Detached HEAD": "游离头",
    本地有改动: "改动",
    未跟踪文件: "未跟踪",
    "未配置 upstream": "缺 upstream",
    已取消: "取消",
    已跳过: "跳过",
    已同步: "已同步",
    状态正常: "正常",
    已禁用: "禁用"
  };
  return labelMap[label] ?? label;
}

function formatCompactSyncMessage(value?: string | null) {
  if (!value) return "-";
  return value.replace(/。$/, "");
}

function getDateKey(value?: string | null) {

  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${(seconds / 60).toFixed(1)} min`;
}

function getInitialView() {
  const route = readRouteStateFromLocation();
  return route?.kind === "main" ? route.view : "repositories";
}

function getInitialRepoDetailRoute() {
  const route = readRouteStateFromLocation();
  return route?.kind === "repo-detail" ? route : null;
}

function buildRoutePath(route: RouteState) {
  return route.kind === "repo-detail" ? `/repo/${encodeURIComponent(route.repoId)}` : "/";
}

function readRouteStateFromLocation(): RouteState | null {
  const pathname = decodeURIComponent(window.location.pathname);
  const routeMatch = pathname.match(/^\/repo\/([^/]+)$/);
  if (routeMatch) {
    const state = parseRouteState(window.history.state);
    return {
      kind: "repo-detail",
      repoId: routeMatch[1],
      originView: state?.kind === "repo-detail" ? state.originView : "repositories"
    };
  }
  return parseRouteState(window.history.state);
}

function parseRouteState(value: unknown): RouteState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

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
  return value === "overview" || value === "repositories" || value === "tasks" || value === "settings" ? value : null;
}

function NavButton(props: { active: boolean; icon: string; label: string; onClick: () => void }) {

  return (
    <button className={`nav-button ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-icon" aria-hidden="true">{props.icon}</span>
      <strong>{props.label}</strong>
    </button>
  );
}

function TabBar(props: {
  items: Array<{ key: string; label: string }>;
  activeKey: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="tab-bar" role="tablist">
      {props.items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={props.activeKey === item.key}
          className={`tab-button ${props.activeKey === item.key ? "active" : ""}`}
          onClick={() => props.onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}


function SummaryPill(props: { label: string; value: number | string; tone: RepoTone }) {
  return (
    <div className={`summary-pill ${props.tone}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function StatCard(props: { label: string; value: number | string; helper: string }) {
  return (
    <section className="stat-card card">
      <p className="muted">{props.label}</p>
      <h3>{props.value}</h3>
      <p className="helper">{props.helper}</p>
    </section>
  );
}

function Badge(props: { tone: RepoTone; text: string }) {
  return <span className={`badge ${props.tone}`}>{props.text}</span>;
}

function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </div>
  );
}

function InlineNoticeList(props: { notices: AppErrorResponse[]; emptyTitle: string; emptyDescription: string }) {
  if (!props.notices.length) {
    return <EmptyState title={props.emptyTitle} description={props.emptyDescription} />;
  }

  return (
    <div className="stack-list compact-list modal-list">
      {props.notices.map((notice) => (
        <div key={`${notice.code}-${notice.title}`} className="list-item import-warning-item">
          <div className="summary-row wrap">
            <strong>{notice.title}</strong>
            <Badge tone={notice.level === "warning" ? "warning" : "danger"} text={notice.code} />
          </div>
          <p>{notice.message}</p>
          {notice.action ? <p className="muted">建议操作：{notice.action}</p> : null}
          {notice.detail ? <p className="muted">技术细节：{notice.detail}</p> : null}
        </div>
      ))}
    </div>
  );
}

function InfoField(props: { label: string; value: string }) {

  return (
    <div className="info-field">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!props.open) {
    return null;
  }
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <div>
            <h3>{props.title}</h3>
          </div>
          <button className="ghost-button" onClick={props.onClose}>关闭</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}
