import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AppProvider, useApp } from "./context/AppContext";
import { NavButton, CatBoatIcon } from "./components";
import { OverviewPage, TasksPage, SettingsPage, RepositoriesPage } from "./pages";
import { ImportModal, AddRepoModal, CloneRepoModal } from "./components/modals";
import { primaryNavItems, UI_TEXT } from "./constants";
import type { SyncProgressEvent } from "./types";

function AppContent() {
  const {
    view, loading, busyAction,
    activePrimaryView, repoDetailOpen,
    settings, gitEnvironment,
    notice,
    navigateToView, handleRefresh, handleSync,
    loadSnapshot, refreshWorkspaceState,
    setSyncTask, setTasks, setCurrentTaskRepoName,
    syncTask, tasks,
    setNotice,
    setAddModalOpen,
    handleSaveSettings,
    settingsTab
  } = useApp();

  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        await loadSnapshot();
      } catch (error) {
        console.error("Failed to load snapshot:", error);
      }
    };
    init();
  }, [refreshWorkspaceState, setCurrentTaskRepoName, setSyncTask, setTasks]);

  // Theme
  useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      root.classList.toggle("dark", isDark);
      root.setAttribute("data-theme", isDark ? "dark" : "light");
      root.style.colorScheme = isDark ? "dark" : "light";
    };

    if (settings.themeMode === "dark") {
      applyTheme(true);
      return;
    }

    if (settings.themeMode === "light") {
      applyTheme(false);
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [settings.themeMode]);


  // Sync progress listener
  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | null = null;
    const setupListener = async () => {
      const unlisten = await listen<SyncProgressEvent>("sync-progress", (event) => {
        if (disposed) return;
        const progress = event.payload;
        setCurrentTaskRepoName(progress.currentRepoName ?? "");
        if (progress.task) {
          setSyncTask(progress.task);
          const updatedTask = progress.task;
          setTasks((prevTasks) =>
            prevTasks.findIndex((t) => t.taskId === updatedTask.taskId) >= 0
              ? prevTasks.map((t) => t.taskId === updatedTask.taskId ? updatedTask : t)
              : [updatedTask, ...prevTasks]
          );
          if (!updatedTask.running) {
            void refreshWorkspaceState(false);
          }
        }
      });
      unlistenFn = unlisten;
    };
    void setupListener();
    return () => {
      disposed = true;
      unlistenFn?.();
    };
  }, []);

  // Notice auto-hide
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Sync task selection sync
  useEffect(() => {
    if (syncTask?.running && !tasks.find((t) => t.taskId === syncTask.taskId)) {
      setTasks([syncTask, ...tasks]);
    }
  }, [syncTask, tasks]);

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
                <p className="eyebrow">{text.repoDetail.eyebrow}</p>
                <h2>{text.repoDetail.title}</h2>
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
                    <button className="ghost-button" onClick={() => setAddModalOpen(true)}>添加仓库</button>
                  </>
                ) : null}
              </div>
            )}
          </div>
          <div className="toolbar-actions">
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
            </div>
            {notice.message ? <p>{notice.message}</p> : null}
          </div>
        ) : null}

        {loading ? (
          <div className="fullscreen-loading-panel">
            <CatBoatIcon className="loading-icon cat-boat-svg" />
            <div className="loading-title">同步坞</div>
            <div className="fade-in-text">{text.toolbar.loading}</div>
            <div className="loading-progress">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        ) : (
          <div className="content-layout single-column">
            {view === "overview" && <OverviewPage />}
            {activePrimaryView === "repositories" && <RepositoriesPage />}
            {view === "tasks" && <TasksPage />}
            {view === "settings" && <SettingsPage />}
          </div>
        )}
      </main>

      <ImportModal />
      <AddRepoModal />
      <CloneRepoModal />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
