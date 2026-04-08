import { useMemo, useEffect, useState } from "react";
import { FixedSizeList } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import type { CSSProperties } from "react";
import { TabBar, SummaryPill, Badge, EmptyState, InfoField, Modal } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT, statusFilterOptions, LOG_PARSE_MAX_LINES, REPO_DETAIL_LOG_PREVIEW_LIMIT } from "../constants";
import { api } from "../api";
import { formatDateTime, formatCompactDateTime, formatCompactSyncMessage } from "../utils/formatters";
import { getRepositoryMeta, getRepositoryOwnershipLabel, getRepositoryOwnershipTone, sortRepositories, sortRepositoriesByStatus } from "../utils/repoHelpers";
import { toneFromLogLevel } from "../utils/taskHelpers";
import { parseTaskLog } from "../utils/logParser";
import type { LogLevelFilter } from "../context/AppContext";
import type { RepositoryRecord } from "../types";

const DEFAULT_GROUP = "未分组";

function uniqueGroups(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function RepositoriesPage() {
  const {
    repositoryTab, setRepositoryTab,
    repositoryGroupTab, setRepositoryGroupTab,
    search, setSearch,
    statusFilter, setStatusFilter,
    groupFilter, setGroupFilter,
    repoLogSearch, setRepoLogSearch,
    repoLogLevelFilter, setRepoLogLevelFilter,
    selectedRepoId, setSelectedRepoId,
    selectedRepoIds, toggleRepoSelection, toggleSelectAllVisible,
    repositories, setRepositories, groups, settings, selectedRepo, repoForm,
    busyAction, repoDetailOpen,
    openRepoDetail, closeRepoDetail,
    handleSync, handleForceSync, handleRefresh,
    handleSaveRepository, handleRemoveRepository,
    handleExportRepositoryLog,
    pickFolder, copyText, setRepoForm,
    showNotice
  } = useApp();

  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];

  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [groupManagerFocus, setGroupManagerFocus] = useState<"create" | "remove">("create");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupsToDelete, setGroupsToDelete] = useState<string[]>([]);
  const [groupActionBusy, setGroupActionBusy] = useState<"create" | "remove" | null>(null);

  const allGroups = useMemo(
    () => uniqueGroups([...groups, ...customGroups]),
    [groups, customGroups]
  );

  useEffect(() => {
    setCustomGroups((current) => current.filter((group) => !groups.includes(group)));
  }, [groups]);

  useEffect(() => {
    if (repositoryGroupTab !== "all" && !allGroups.includes(repositoryGroupTab)) {
      setRepositoryGroupTab("all");
    }
  }, [allGroups, repositoryGroupTab, setRepositoryGroupTab]);

  useEffect(() => {
    setGroupsToDelete((current) => current.filter((group) => allGroups.includes(group)));
  }, [allGroups]);

  const workspaceRepositories = useMemo(() => {
    let result = repositories;
    if (repositoryGroupTab !== "all") {
      result = result.filter((repo) => repo.group === repositoryGroupTab);
    }
    return sortRepositoriesByStatus(result, settings);
  }, [repositories, repositoryGroupTab, settings]);

  const repositoryViewData = useMemo(() => {
    let result = repositories;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((repo) =>
        repo.name.toLowerCase().includes(q) ||
        repo.path.toLowerCase().includes(q) ||
        repo.group.toLowerCase().includes(q) ||
        (repo.status.currentBranch || "").toLowerCase().includes(q)
      );
    }
    if (groupFilter !== "all") {
      result = result.filter((repo) => repo.group === groupFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((repo) => {
        const meta = getRepositoryMeta(repo, settings);
        if (statusFilter === "needsSync") return repo.status.syncRequired;
        if (statusFilter === "warning") return meta.tone === "warning";
        if (statusFilter === "failed") return meta.tone === "danger";
        if (statusFilter === "disabled") return !repo.enabled;
        return true;
      });
    }
    return sortRepositoriesByStatus(result, settings);
  }, [repositories, search, groupFilter, statusFilter, settings]);

  const [repoLogContent, setRepoLogContent] = useState("");
  useEffect(() => {
    let cancelled = false;
    const loader = selectedRepoId
      ? api.getRepositoryLog(selectedRepoId)
      : api.getAllRepositoryLogs();
    loader
      .then((log) => { if (!cancelled) setRepoLogContent(log); })
      .catch(() => { if (!cancelled) setRepoLogContent(""); });
    return () => { cancelled = true; };
  }, [selectedRepoId, repositories]);

  const selectedRepoLog = repoLogContent;
  const parsedRepoLogLines = useMemo(() => parseTaskLog(selectedRepoLog), [selectedRepoLog]);
  const filteredRepoLogLines = useMemo(() => {
    return parsedRepoLogLines.filter((line) => {
      if (repoLogSearch) {
        const q = repoLogSearch.toLowerCase();
        if (!line.text.toLowerCase().includes(q) && !(line.code?.toLowerCase().includes(q))) return false;
      }
      if (repoLogLevelFilter === "warning" && line.level !== "warning") return false;
      if (repoLogLevelFilter === "error" && line.level !== "error") return false;
      return true;
    });
  }, [parsedRepoLogLines, repoLogSearch, repoLogLevelFilter]);

  const repoGroupOptions = useMemo(() => allGroups, [allGroups]);

  useEffect(() => {
    if (repoDetailOpen && selectedRepo) {
      setRepoForm({
        id: selectedRepo.id,
        name: selectedRepo.name,
        path: selectedRepo.path,
        group: selectedRepo.group,
        ownership: selectedRepo.ownership,
        note: selectedRepo.note,
        enabled: selectedRepo.enabled
      });
    } else if (!repoDetailOpen) {
      setRepoForm(null);
    }
  }, [repoDetailOpen, selectedRepo, setRepoForm]);

  const openGroupManager = (focus: "create" | "remove") => {
    setGroupManagerFocus(focus);
    setNewGroupName("");
    setGroupsToDelete([]);
    setGroupManagerOpen(true);
  };

  const handleCreateGroup = async () => {
    const value = newGroupName.trim();
    if (!value) {
      showNotice("warning", "请输入分组名称");
      return;
    }
    if (allGroups.includes(value)) {
      setRepositoryGroupTab(value);
      setGroupManagerOpen(false);
      showNotice("success", "已切换到现有分组");
      return;
    }
    setGroupActionBusy("create");
    try {
      setCustomGroups((current) => uniqueGroups([...current, value]));
      setRepositoryGroupTab(value);
      setNewGroupName("");
      setGroupManagerOpen(false);
      showNotice("success", `已创建分组“${value}”`);
    } finally {
      setGroupActionBusy(null);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupsToDelete.length) {
      showNotice("warning", "\u8bf7\u5148\u9009\u62e9\u8981\u5220\u9664\u7684\u5206\u7ec4");
      return;
    }
    if (!window.confirm(`\u5220\u9664\u9009\u4e2d\u7684 ${groupsToDelete.length} \u4e2a\u5206\u7ec4\u540e\uff0c\u76f8\u5173\u4ed3\u5e93\u4f1a\u7edf\u4e00\u79fb\u52a8\u5230\u201c${DEFAULT_GROUP}\u201d\u3002\u786e\u5b9a\u7ee7\u7eed\u5417\uff1f`)) {
      return;
    }

    const groupsToDeleteSet = new Set(groupsToDelete);
    const reposInGroup = repositories.filter((repo) => groupsToDeleteSet.has(repo.group));
    setGroupActionBusy("remove");
    try {
      if (reposInGroup.length > 0) {
        const updatedRecords = await Promise.all(
          reposInGroup.map((repo) =>
            api.updateRepository({
              id: repo.id,
              name: repo.name,
              path: repo.path,
              group: DEFAULT_GROUP,
              ownership: repo.ownership,
              note: repo.note,
              enabled: repo.enabled
            })
          )
        );
        const updatedMap = new Map(updatedRecords.map((repo) => [repo.id, repo]));
        setRepositories(sortRepositories(repositories.map((repo) => updatedMap.get(repo.id) ?? repo)));
      }

      setCustomGroups((current) => current.filter((group) => !groupsToDeleteSet.has(group)));
      if (groupsToDeleteSet.has(repositoryGroupTab)) {
        setRepositoryGroupTab("all");
      }
      if (groupsToDeleteSet.has(groupFilter)) {
        setGroupFilter("all");
      }
      setGroupsToDelete([]);
      setGroupManagerOpen(false);
      showNotice("success", `\u5df2\u5220\u9664 ${groupsToDelete.length} \u4e2a\u5206\u7ec4`);
    } catch {
      showNotice("error", "\u5220\u9664\u5206\u7ec4\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5");
    } finally {
      setGroupActionBusy(null);
    }
  };
  if (repoDetailOpen && selectedRepo && repoForm) {
    return (
      <section className="card panel repo-detail-panel">
        <div className="panel-header repo-detail-header">
          <div className="repo-detail-header-top">
            <div className="repo-detail-heading">
              <button className="text-link-button" onClick={closeRepoDetail}>{text.repoDetail.back}</button>
              <h3>{selectedRepo.name}</h3>
            </div>
            <div className="summary-row wrap repo-detail-summary-row">
              <SummaryPill label="ahead" value={selectedRepo.status.aheadCount} tone="neutral" />
              <SummaryPill label="behind" value={selectedRepo.status.behindCount} tone="pending" />
              <SummaryPill label="本地改动" value={selectedRepo.status.hasUncommittedChanges ? "有" : "无"} tone={selectedRepo.status.hasUncommittedChanges ? "warning" : "success"} />
              <SummaryPill label="启用" value={repoForm.enabled ? "是" : "否"} tone={repoForm.enabled ? "success" : "neutral"} />
              <Badge tone={getRepositoryOwnershipTone(selectedRepo.ownership)} text={getRepositoryOwnershipLabel(selectedRepo.ownership)} />
              <Badge tone={getRepositoryMeta(selectedRepo, settings).tone} text={getRepositoryMeta(selectedRepo, settings).label} />
            </div>
          </div>
          <div className="inline-actions wrap repo-detail-action-row">
            <button className="primary-button" onClick={() => void handleSaveRepository()} disabled={busyAction === "repo-save"}>保存信息</button>
            <button className="ghost-button" onClick={() => void handleSync([selectedRepo.id])}>立即同步</button>
            <button className="ghost-button" onClick={() => { if (window.confirm("强制同步将覆盖本地更改，确定继续吗？")) void handleForceSync([selectedRepo.id]); }}>强制同步</button>
            <button className="ghost-button" onClick={() => void handleRefresh([selectedRepo.id])}>{busyAction === "refresh" ? <><span className="inline-spinner"></span>刷新中...</> : "刷新状态"}</button>
            <button className="ghost-button" onClick={() => void api.openExternal(repoForm.path)} disabled={!repoForm.path.trim()}>打开目录</button>
            <button className="ghost-button" onClick={() => void copyText(repoForm.path, "路径已复制")}>复制路径</button>
            <button className="danger-button" onClick={() => void handleRemoveRepository()} disabled={busyAction === "repo-remove"}>移除仓库</button>
          </div>
        </div>

        <div className="repo-detail-body">
          <section className="inset-card repo-detail-form-card">
            <div className="panel-header mini">
              <div>
                <h4>编辑信息</h4>
                <p className="muted">名称、分组、归属和同步参与设置</p>
              </div>
            </div>
            <div className="form-grid two-columns repo-detail-form-grid">
              <label className="full-span">
                <span>仓库名称</span>
                <input value={repoForm.name} onChange={(e) => setRepoForm((c) => c ? { ...c, name: e.target.value } : c)} />
              </label>
              <div className="repo-detail-inline-fields full-span">
                <label>
                  <span>分组</span>
                  <select
                    value={repoGroupOptions.includes(repoForm.group) ? repoForm.group : "__custom__"}
                    onChange={(e) => setRepoForm((c) => c ? { ...c, group: e.target.value === "__custom__" ? "" : e.target.value } : c)}
                  >
                    {repoGroupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                    <option value="__custom__">新建分组...</option>
                  </select>
                  {!repoGroupOptions.includes(repoForm.group) ? (
                    <input
                      value={repoForm.group}
                      onChange={(e) => setRepoForm((c) => c ? { ...c, group: e.target.value } : c)}
                      placeholder="输入新的分组名称"
                    />
                  ) : null}
                </label>
                <label>
                  <span>仓库归属</span>
                  <select value={repoForm.ownership} onChange={(e) => setRepoForm((c) => c ? { ...c, ownership: e.target.value as typeof c.ownership } : c)}>
                    <option value="unassigned">未标注</option>
                    <option value="mine">我的</option>
                    <option value="other">其他作者</option>
                  </select>
                </label>
              </div>
              <label className="switch-row full-span repo-detail-toggle-row">
                <input type="checkbox" checked={repoForm.enabled} onChange={(e) => setRepoForm((c) => c ? { ...c, enabled: e.target.checked } : c)} />
                <span>启用该仓库参与同步</span>
              </label>
              <label className="full-span">
                <span>仓库路径</span>
                <div className="path-input">
                  <input value={repoForm.path} onChange={(e) => setRepoForm((c) => c ? { ...c, path: e.target.value } : c)} />
                  <button type="button" className="ghost-button" onClick={() => void pickFolder((v) => setRepoForm((c) => c ? { ...c, path: v } : c))}>选择目录</button>
                </div>
              </label>
              <label className="full-span">
                <span>备注</span>
                <textarea value={repoForm.note} onChange={(e) => setRepoForm((c) => c ? { ...c, note: e.target.value } : c)} rows={4} />
              </label>
            </div>
          </section>

          <section className="inset-card repo-detail-status-card">
            <div className="panel-header mini">
              <div>
                <h4>状态摘要</h4>
                <p className="muted">归属、分支、同步记录与当前状态</p>
              </div>
            </div>
            <div className="info-grid compact repo-detail-status-grid">
              <InfoField label="remote URL" value={selectedRepo.remoteUrl || "-"} />
              <InfoField label="仓库归属" value={getRepositoryOwnershipLabel(selectedRepo.ownership)} />
              <InfoField label="当前分支" value={selectedRepo.status.currentBranch || "-"} />
              <InfoField label="upstream" value={selectedRepo.status.upstreamName || "未配置"} />
              <InfoField label="最近同步" value={formatDateTime(selectedRepo.lastSyncAt)} />
              <InfoField label="最近结果" value={selectedRepo.lastSyncMessage || "-"} />
              <InfoField label="状态说明" value={selectedRepo.status.statusText || "-"} />
            </div>
          </section>

          <section className="inset-card repo-detail-log-card">
            <div className="panel-header mini">
              <div><h4>同步日志</h4><p className="muted">当前仓库历史日志</p></div>
              <div className="inline-actions wrap">
                <button className="ghost-button" onClick={() => void copyText(filteredRepoLogLines.map((l) => l.text).join("\n") || selectedRepoLog, "仓库日志已复制")}>复制日志</button>
                <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={busyAction === "export-repo-log"}>导出日志</button>
              </div>
            </div>
            <div className="task-log-toolbar repo-log-toolbar">
              <label className="search-box compact-search"><input value={repoLogSearch} onChange={(e) => setRepoLogSearch(e.target.value)} placeholder="搜索仓库日志、错误码" /></label>
              <select value={repoLogLevelFilter} onChange={(e) => setRepoLogLevelFilter(e.target.value as LogLevelFilter)}>
                <option value="all">全部日志</option>
                <option value="warning">仅警告</option>
                <option value="error">仅错误</option>
              </select>
            </div>
            {selectedRepoLog.trim() ? <p className="helper">为避免超长日志导致界面卡顿，仅展示最近 {REPO_DETAIL_LOG_PREVIEW_LIMIT} 条结果。</p> : null}
            <div className="log-line-list repo-log-list">
              {filteredRepoLogLines.slice(0, REPO_DETAIL_LOG_PREVIEW_LIMIT).map((line) => (
                <div key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                  <span className="log-line-index">#{line.index}</span>
                  <div className="log-line-badges">
                    <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                    {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                  </div>
                  <code className="log-line-text">{line.text}</code>
                </div>
              ))}
              {!filteredRepoLogLines.length ? <EmptyState title="暂无日志记录" description="该仓库还没有可展示的日志。" /> : null}
            </div>
          </section>
        </div>
      </section>
    );
  }

  if (repoDetailOpen) {
    return (
      <section className="card panel">
        <EmptyState title="未找到仓库" description="请返回仓库页重新选择仓库。" />
      </section>
    );
  }

  return (
    <>
      <section className="card panel">
        <TabBar
          items={[
            { key: "workspace", label: text.repositoryTabs.workspace },
            { key: "list", label: text.repositoryTabs.list },
            { key: "logs", label: text.repositoryTabs.logs }
          ]}
          activeKey={repositoryTab}
          onChange={(key) => setRepositoryTab(key as "workspace" | "list" | "logs")}
        />

        {repositoryTab === "workspace" ? (
          <div className="view-stack">
            <div className="tab-bar-with-action repo-group-tab-row">
              <TabBar
                items={[{ key: "all", label: `全部分组 (${repositories.length})` }, ...allGroups.map((g) => ({ key: g, label: g }))]}
                activeKey={repositoryGroupTab}
                onChange={setRepositoryGroupTab}
              />
              <div className="repo-group-controls">
                <button className="repo-group-plain-button add" title="新增分组" onClick={() => openGroupManager("create")}>+</button>
                <button className="repo-group-plain-button remove" title="删除分组" onClick={() => openGroupManager("remove")}>-</button>
              </div>
            </div>
            <div className="inline-actions wrap">
              <button className="primary-button" onClick={() => void handleSync(undefined, repositoryGroupTab !== "all" ? repositoryGroupTab : undefined)} disabled={busyAction === "sync"}>
                {repositoryGroupTab !== "all" ? "同步当前分组" : "同步全部"}
              </button>
              <button className="ghost-button" onClick={() => { if (window.confirm("强制同步将覆盖本地更改，确定继续吗？")) void handleForceSync(undefined, repositoryGroupTab !== "all" ? repositoryGroupTab : undefined); }} disabled={busyAction === "sync"}>
                {repositoryGroupTab !== "all" ? "强制同步分组" : "强制同步全部"}
              </button>
            </div>
            <div className="repo-list">
              {workspaceRepositories.map((repo) => {
                const meta = getRepositoryMeta(repo, settings);
                return (
                  <article key={repo.id} className="repo-item compact-row">
                    <div className="repo-main">
                      <div className="repo-title-row">
                        <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "repositories")} title={repo.path}>{repo.name}</button>
                        <Badge tone={getRepositoryOwnershipTone(repo.ownership)} text={getRepositoryOwnershipLabel(repo.ownership)} />
                      </div>
                      <div className="repo-meta-row">
                        <span className="repo-cell-ellipsis" title={`分组：${repo.group}`}>{repo.group}</span>
                        <span className="repo-cell-mono">{repo.status.currentBranch || "-"}</span>
                        <span className="repo-cell-mono">{formatCompactDateTime(repo.lastSyncAt)}</span>
                      </div>
                    </div>
                    <div className="repo-side" title={meta.label}>
                      <Badge tone={meta.tone} text={meta.label} />
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
            <div className="filters-row repo-list-filter-row">
              <label className="search-box compact-search repo-filter-search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 名称 / 路径 / 分支" /></label>
              <select className="repo-filter-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                <option value="all">全部分组</option>
                {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select className="repo-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {statusFilterOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.value === "all" ? "全部状态" : item.label}
                  </option>
                ))}
              </select>
              <label className="check-wrap compact">
                <input type="checkbox" checked={repositoryViewData.length > 0 && repositoryViewData.every((r) => selectedRepoIds.includes(r.id))} onChange={toggleSelectAllVisible} />
                <span>全选</span>
              </label>
              <button className="primary-button compact" onClick={() => void handleSync(selectedRepoIds)} disabled={!selectedRepoIds.length || busyAction === "sync"}>同步{selectedRepoIds.length ? ` (${selectedRepoIds.length})` : ""}</button>
              <button className="ghost-button compact" onClick={() => { if (window.confirm("强制同步将覆盖本地更改，确定继续吗？")) void handleForceSync(selectedRepoIds); }} disabled={!selectedRepoIds.length || busyAction === "sync"}>强制同步</button>
            </div>
            <div className="repo-table" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 400 }}>
              <div className="repo-table-row repo-table-head" style={{ flex: "0 0 auto" }}>
                <span>仓库</span><span>归属</span><span>分组</span><span>分支</span><span>同步</span><span>结果</span><span>状态</span>
              </div>
              <div style={{ flex: 1 }}>
                <AutoSizer>
                  {({ height, width }: { height: number; width: number }) => (
                    <FixedSizeList itemSize={46} itemCount={repositoryViewData.length} height={height} width={width}>
                      {({ index, style }: { index: number; style: CSSProperties }) => {
                        const repo = repositoryViewData[index];
                        const meta = getRepositoryMeta(repo, settings);
                        const isSelected = selectedRepoIds.includes(repo.id);
                        return (
                          <div key={repo.id} style={style} className="repo-table-row">
                            <div className="repo-table-name-cell">
                              <label className="check-wrap"><input type="checkbox" checked={isSelected} onChange={() => toggleRepoSelection(repo.id)} /></label>
                              <div className="repo-table-primary">
                                <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "repositories")} title={repo.path}>{repo.name}</button>
                              </div>
                            </div>
                            <span title={getRepositoryOwnershipLabel(repo.ownership)}><Badge tone={getRepositoryOwnershipTone(repo.ownership)} text={getRepositoryOwnershipLabel(repo.ownership)} /></span>
                            <span className="repo-cell-ellipsis" title={repo.group}>{repo.group}</span>
                            <span className="repo-cell-mono">{repo.status.currentBranch || "-"}</span>
                            <span className="repo-cell-mono">{formatCompactDateTime(repo.lastSyncAt)}</span>
                            <span className="repo-cell-ellipsis">{formatCompactSyncMessage(repo.lastSyncMessage)}</span>
                            <Badge tone={meta.tone} text={meta.label} />
                          </div>
                        );
                      }}
                    </FixedSizeList>
                  )}
                </AutoSizer>
              </div>
            </div>
            {!repositoryViewData.length ? <EmptyState title="未找到匹配结果" description="可以调整筛选条件，或先导入新的本地仓库。" /> : null}
          </div>
        ) : null}

        {repositoryTab === "logs" ? (
          <div className="view-stack">
            <div className="task-log-toolbar repo-center-log-toolbar">
              <label className="search-box compact-search"><input value={repoLogSearch} onChange={(e) => setRepoLogSearch(e.target.value)} placeholder="搜索仓库日志" /></label>
              <select value={repoLogLevelFilter} onChange={(e) => setRepoLogLevelFilter(e.target.value as LogLevelFilter)}>
                <option value="all">全部日志</option>
                <option value="warning">仅警告</option>
                <option value="error">仅错误</option>
              </select>
              <select value={selectedRepoId} onChange={(e) => setSelectedRepoId(e.target.value)}>
                <option value="">全部仓库</option>
                {repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
              </select>
              <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={busyAction === "export-repo-log"}>导出日志</button>
            </div>
            {selectedRepoLog.trim() ? <p className="helper">为避免超长日志导致界面卡顿，仅解析最近 {LOG_PARSE_MAX_LINES} 行，并对超长单行进行安全截断。</p> : null}
            <div className="log-line-list repo-log-list" style={{ flex: 1, minHeight: 400 }}>
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList itemSize={60} itemCount={filteredRepoLogLines.length} height={height} width={width}>
                    {({ index, style }: { index: number; style: CSSProperties }) => {
                      const line = filteredRepoLogLines[index];
                      return (
                        <div style={style} key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                          <span className="log-line-index">#{line.index}</span>
                          <div className="log-line-badges">
                            <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                            {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                          </div>
                          <code className="log-line-text">{line.text}</code>
                          {line.textTruncated ? <span className="log-line-truncated-hint">该行过长，已截断显示</span> : null}
                        </div>
                      );
                    }}
                  </FixedSizeList>
                )}
              </AutoSizer>
            </div>
            {!filteredRepoLogLines.length ? <EmptyState title="暂无日志记录" description="请选择仓库，或调整筛选条件。" /> : null}
          </div>
        ) : null}
      </section>

      <Modal open={groupManagerOpen} title={groupManagerFocus === "create" ? "\u65b0\u589e\u5206\u7ec4" : "\u5220\u9664\u5206\u7ec4"} onClose={() => setGroupManagerOpen(false)}>
        {groupManagerFocus === "create" ? (
          <div className="repo-group-manager-single">
            <section className="repo-group-manager-section active">
              <div className="panel-header mini">
                <div>
                  <h4>{"新增分组"}</h4>
                  <p className="muted">{"这里可以直接新增分组，并查看当前已有的全部分组。"}</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span>{"分组名称"}</span>
                  <input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="输入新的分组名称" />
                </label>
              </div>
              <div className="repo-group-existing">
                <div className="repo-group-existing-header">
                  <strong>{"已有分组"}</strong>
                  <span>{allGroups.length} {"个"}</span>
                </div>
                <div className="repo-group-chip-list">
                  {allGroups.length ? allGroups.map((group) => (
                    <button key={group} type="button" className="repo-group-chip" onClick={() => setNewGroupName(group)}>{group}</button>
                  )) : <span className="muted">{"暂无分组"}</span>}
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="repo-group-manager-single">
            <section className="repo-group-manager-section active">
              <div className="panel-header mini">
                <div>
                  <h4>{"删除分组"}</h4>
                  <p className="muted">{"支持一次选择多个分组统一删除。"}</p>
                </div>
              </div>
              <div className="form-grid">
                <label>
                  <span className="repo-group-field-head">
                    <span>{"选择分组"}</span>
                    <span className="repo-group-tip">{"删除后仓库会移动到“未分组”"}</span>
                  </span>
                  <div className="repo-group-delete-list">
                    {allGroups.length ? allGroups.map((group) => {
                      const checked = groupsToDelete.includes(group);
                      return (
                        <label key={group} className="repo-group-delete-item">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setGroupsToDelete((current) => e.target.checked ? [...current, group] : current.filter((item) => item !== group))}
                          />
                          <span>{group}</span>
                        </label>
                      );
                    }) : <span className="muted">{"暂无可删除分组"}</span>}
                  </div>
                </label>
              </div>
            </section>
          </div>
        )}
        <div className="modal-footer repo-group-manager-footer">
          <button className="ghost-button" onClick={() => setGroupManagerOpen(false)}>{"关闭"}</button>
          {groupManagerFocus === "create" ? (
            <button className="primary-button" onClick={() => void handleCreateGroup()} disabled={groupActionBusy !== null}>
              {groupActionBusy === "create" ? "创建中..." : "新增分组"}
            </button>
          ) : (
            <button className="danger-button" onClick={() => void handleDeleteGroup()} disabled={groupActionBusy !== null || !allGroups.length || !groupsToDelete.length}>
              {groupActionBusy === "remove" ? "删除中..." : "删除分组" + (groupsToDelete.length ? ` (${groupsToDelete.length})` : "")}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
