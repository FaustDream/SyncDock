import type { AppSettings, GitEnvironment, LogsDiagnostics } from "./types";

export const defaultSettings: AppSettings = {
  concurrentLimit: 3,
  commandTimeoutSecs: 45,
  autoRetryTransientFailures: true,
  skipUntrackedFiles: false,
  showDebugLogs: true,
  logRetentionDays: 30,
  logsDirectory: "",
  defaultView: "overview",
  themeMode: "system",
  languageMode: "zh-CN",
  syncMode: "safe"
};

export const defaultGitEnvironment: GitEnvironment = {
  available: false,
  version: "",
  executablePath: "",
  message: "未检测到 Git",
  checkedAt: new Date().toISOString()
};

export const defaultLogsDiagnostics: LogsDiagnostics = {
  directory: "",
  configuredDirectory: null,
  usingCustomDirectory: false,
  fallbackActive: false,
  fileCount: 0,
  totalSizeBytes: 0,
  writable: false
};

export const LOG_PARSE_MAX_LINES = 2000;
export const LOG_LINE_TEXT_MAX_LENGTH = 1200;
export const LOG_VIRTUALIZATION_THRESHOLD = 20;
export const REPO_DETAIL_LOG_PREVIEW_LIMIT = 200;

export const statusFilterOptions = [

  { value: "all", label: "全部状态" },
  { value: "needsSync", label: "待同步" },
  { value: "warning", label: "受保护跳过" },
  { value: "failed", label: "失败" },
  { value: "disabled", label: "已禁用" }
] as const;

export const primaryNavItems: Array<{ key: ViewKey; icon: string }> = [
  { key: "overview", icon: "🏠" },
  { key: "repositories", icon: "📦" },
  { key: "tasks", icon: "📋" },
  { key: "settings", icon: "⚙️" }
];

export type ViewKey = "overview" | "repositories" | "tasks" | "settings";

export const UI_TEXT = {
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

export type LanguageMode = "zh-CN" | "en-US";
