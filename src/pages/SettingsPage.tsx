import { useCallback, useState } from "react";
import { TabBar, InfoField } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT } from "../constants";
import { formatBytes, formatDateTime } from "../utils/formatters";
import type { PreferredView, SyncMode, ThemeMode, LanguageMode } from "../types";
import { normalizePreferredView, normalizeThemeMode, normalizeLanguageMode } from "../utils/routeHelpers";
import { api } from "../api";
import { checkForUpdate, openReleasePage, getCurrentVersion } from "../utils/updateChecker";
import type { UpdateInfo } from "../utils/updateChecker";

export function SettingsPage() {
  const {
    settingsTab, setSettingsTab,
    settings, setSettings,
    gitEnvironment, logsDiagnostics,
    configDirectory, logsDirectory,
    busyAction,
    handleSaveSettings, handleCleanupLogs, handleExportConfig,
    handleChangeConfigDirectory, handleResetConfigDirectory, handleResetLogsDirectory,
    handleSelectImportConfig, pickFolder
  } = useApp();

  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const currentVersion = getCurrentVersion();


  const handleCheckUpdate = useCallback(async () => {
    try {
      setCheckingUpdate(true);
      const info = await checkForUpdate(currentVersion);
      setUpdateInfo(info);

      if (info.hasUpdate) {
        const confirmMsg = settings.languageMode === "en-US"
          ? `New version ${info.latestVersion} available!\n\nCurrent: ${info.currentVersion}\nLatest: ${info.latestVersion}\n\nOpen the latest GitHub Release download page?`
          : `发现新版本 ${info.latestVersion}！\n\n当前版本：${info.currentVersion}\n最新版本：${info.latestVersion}\n\n是否打开 GitHub Releases 最新版本下载页？`;
        if (window.confirm(confirmMsg)) {
          await openReleasePage(info.releaseUrl);
        }
      } else {
        const msg = settings.languageMode === "en-US"
          ? "You are using the latest version!"
          : "当前已是最新版本！";
        alert(msg);
      }
    } catch (e) {
      const errorMsg = settings.languageMode === "en-US"
        ? "Failed to check for updates. Please try again later."
        : "检查更新失败，请稍后重试或检查网络连接。";
      alert(errorMsg);
    } finally {
      setCheckingUpdate(false);
    }
  }, [settings.languageMode, currentVersion]);


  // 主题切换时立即保存
  const handleThemeChange = useCallback((theme: ThemeMode) => {
    const normalized = normalizeThemeMode(theme);
    const nextSettings = { ...settings, themeMode: normalized };
    setSettings(nextSettings);
    void api.saveSettings(nextSettings);
  }, [settings, setSettings]);

  // 语言切换时立即保存
  const handleLanguageChange = useCallback((lang: LanguageMode) => {
    const normalized = normalizeLanguageMode(lang);
    const nextSettings = { ...settings, languageMode: normalized };
    setSettings(nextSettings);
    void api.saveSettings(nextSettings);
  }, [settings, setSettings]);

  // 默认视图切换时立即保存
  const handleDefaultViewChange = useCallback((view: PreferredView) => {
    const normalized = normalizePreferredView(view);
    const nextSettings = { ...settings, defaultView: normalized };
    setSettings(nextSettings);
    void api.saveSettings(nextSettings);
  }, [settings, setSettings]);

  // 通用设置更新并保存
  const updateAndSave = useCallback((updates: Partial<typeof settings>) => {
    const nextSettings = { ...settings, ...updates };
    setSettings(nextSettings);
    void api.saveSettings(nextSettings);
  }, [settings, setSettings]);

  return (
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
        onChange={(key) => setSettingsTab(key as "general" | "sync" | "paths" | "repositories" | "about")}
      />

      {settingsTab === "general" ? (
        <div className="settings-tab-content">
          <div className="form-grid two-columns">
            <label>
              <span>{text.settings.defaultView}</span>
              <select value={settings.defaultView} onChange={(e) => handleDefaultViewChange(e.target.value as PreferredView)}>
                <option value="overview">{text.nav.overview}</option>
                <option value="repositories">{text.nav.repositories}</option>
                <option value="tasks">{text.nav.tasks}</option>
                <option value="settings">{text.nav.settings}</option>
              </select>
            </label>
            <label>
              <span>{text.settings.theme}</span>
              <select value={settings.themeMode} onChange={(e) => handleThemeChange(e.target.value as ThemeMode)}>
                <option value="system">{text.settings.themeSystem}</option>
                <option value="light">{text.settings.themeLight}</option>
                <option value="dark">{text.settings.themeDark}</option>
              </select>
            </label>
            <label>
              <span>{text.settings.windowClose}</span>
              <select disabled><option>{text.settings.closeFixed}</option></select>
            </label>
            <label className="switch-row">
              <input type="checkbox" checked readOnly />
              <span>{text.settings.autoRefresh}</span>
            </label>
            <label>
              <span>{text.settings.language}</span>
              <select value={settings.languageMode} onChange={(e) => handleLanguageChange(e.target.value as LanguageMode)}>
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
              <select value={settings.syncMode ?? "safe"} onChange={(e) => updateAndSave({ syncMode: e.target.value as SyncMode })}>
                <option value="safe">Safe - 安全模式</option>
                <option value="force">Force - 强制模式</option>
                <option value="rebase">Rebase - 变基模式</option>
              </select>
              <p className="helper">Safe: 跳过有本地更改的仓库；Force: 强制覆盖本地更改；Rebase: 变基合并</p>
            </label>
            <label>
              <span>并发数</span>
              <input type="number" min={1} max={5} value={settings.concurrentLimit} onChange={(e) => updateAndSave({ concurrentLimit: Number(e.target.value) || 1 })} />
            </label>
            <label>
              <span>命令超时（秒）</span>
              <input type="number" min={10} max={300} value={settings.commandTimeoutSecs} onChange={(e) => updateAndSave({ commandTimeoutSecs: Number(e.target.value) || 10 })} />
            </label>
            <label className="switch-row">
              <input type="checkbox" checked={settings.skipUntrackedFiles} onChange={(e) => updateAndSave({ skipUntrackedFiles: e.target.checked })} />
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
          </div>
          <section className="inset-card">
            <div className="panel-header mini"><div><h4>默认扫描目录</h4><p className="muted">导入仓库时的默认扫描根路径</p></div></div>
            <div className="info-grid compact">
              <InfoField label="当前目录" value={settings.defaultScanRoot || "未设置"} />
            </div>
            <div className="inline-actions wrap">
              <button className="ghost-button" onClick={() => void pickFolder((v) => updateAndSave({ defaultScanRoot: v }))}>选择目录</button>
              {settings.defaultScanRoot ? <button className="ghost-button" onClick={() => updateAndSave({ defaultScanRoot: "" })}>清除</button> : null}
            </div>
          </section>
          <section className="inset-card">
            <div className="panel-header mini"><div><h4>配置目录</h4><p className="muted">修改后建议重启应用</p></div></div>
            <div className="inline-actions wrap">
              <button className="ghost-button" onClick={() => void handleChangeConfigDirectory()} disabled={busyAction === "config-directory"}>修改目录</button>
              <button className="ghost-button" onClick={() => void handleResetConfigDirectory()} disabled={busyAction === "config-directory"}>恢复默认</button>
            </div>
          </section>
          <section className="inset-card">
            <div className="panel-header mini"><div><h4>日志目录</h4></div></div>
            <div className="inline-actions wrap">
              <button className="ghost-button" onClick={handleResetLogsDirectory}>恢复默认</button>
              <button className="ghost-button" onClick={() => void handleCleanupLogs()} disabled={busyAction === "cleanup-logs"}>清理日志</button>
            </div>
          </section>
          <div className="form-grid two-columns">
            <label>
              <span>日志保留天数</span>
              <select value={String(settings.logRetentionDays)} onChange={(e) => updateAndSave({ logRetentionDays: Number(e.target.value) })}>
                <option value="7">7 天</option>
                <option value="15">15 天</option>
                <option value="30">30 天</option>
                <option value="60">60 天</option>
                <option value="90">90 天</option>
                <option value="0">永久</option>
              </select>
            </label>
            <label className="switch-row">
              <input type="checkbox" checked={settings.showDebugLogs} onChange={(e) => updateAndSave({ showDebugLogs: e.target.checked })} />
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
              <input value={settings.ignoredDirectories.join(", ")} onChange={(e) => updateAndSave({ ignoredDirectories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </label>
            <label>
              <span>扫描深度</span>
              <input type="number" min={1} max={12} value={settings.scanDepth} onChange={(e) => updateAndSave({ scanDepth: Number(e.target.value) || 4 })} />
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
              <div className="panel-header mini"><div><h4>应用信息</h4></div></div>
              <div className="info-grid compact">
                <InfoField label="版本号" value={currentVersion} />
                <InfoField label="Git 环境" value={gitEnvironment.available ? "可用" : "不可用"} />
                <InfoField label="Git 版本" value={gitEnvironment.version || "-"} />
                {updateInfo && (
                  <>
                    <InfoField
                      label="最新版本"
                      value={updateInfo.hasUpdate ? `${updateInfo.latestVersion} (有更新)` : `${updateInfo.latestVersion} (已是最新)`}
                    />
                    <InfoField label="检查来源" value="GitHub Releases" />
                    {updateInfo.publishedAt && (

                      <InfoField label="发布日期" value={formatDateTime(updateInfo.publishedAt)} />
                    )}
                  </>
                )}
              </div>
              <div className="inline-actions wrap">
                <button className="primary-button" onClick={() => void handleCheckUpdate()} disabled={checkingUpdate}>
                  {checkingUpdate ? <><span className="inline-spinner"></span>检查中...</> : "检查更新"}
                </button>
                {updateInfo?.hasUpdate && (
                  <button className="ghost-button" onClick={() => void openReleasePage(updateInfo.releaseUrl)}>
                    查看更新详情
                  </button>
                )}
                {updateInfo?.releaseNotes ? (
                  <p className="helper full-width">最近发布说明：{updateInfo.releaseNotes.split("\n").find((line) => line.trim()) || "检测到新版本，可前往 GitHub Releases 最新版本下载页查看并下载。"}</p>

                ) : null}
                <button className="ghost-button" onClick={() => void handleExportConfig()} disabled={busyAction === "export-config"}>导出诊断配置</button>
              </div>

            </section>
            <section className="inset-card">
              <div className="panel-header mini"><div><h4>环境状态</h4></div></div>
              <div className="info-grid compact">
                <InfoField label="日志文件数" value={String(logsDiagnostics.fileCount)} />
                <InfoField label="占用空间" value={formatBytes(logsDiagnostics.totalSizeBytes)} />
                <InfoField label="Git 说明" value={gitEnvironment.message} />
              </div>
            </section>
          </div>
          <section className="inset-card">
            <div className="panel-header mini"><div><h4>关于 SyncDock</h4></div></div>
            <p className="muted">
              SyncDock 是一款专为开发者设计的 Git 仓库批量同步工具，支持多仓库管理、智能状态检测、批量同步等功能。
            </p>
            <div className="inline-actions wrap">
              <button className="ghost-button" onClick={() => void api.openExternal("https://github.com/FaustDream/SyncDock")}>
                GitHub 仓库
              </button>
              <button className="ghost-button" onClick={() => void api.openExternal("https://github.com/FaustDream/SyncDock/releases")}>
                发布页面
              </button>
              <button className="ghost-button" onClick={() => void api.openExternal("https://github.com/FaustDream/SyncDock/issues")}>
                反馈问题
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
