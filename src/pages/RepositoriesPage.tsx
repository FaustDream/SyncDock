import { useMemo, useEffect, useState } from "react";
import { FixedSizeList } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import type { CSSProperties } from "react";
import { TabBar, SummaryPill, Badge, EmptyState, InfoField } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT, statusFilterOptions, LOG_PARSE_MAX_LINES, REPO_DETAIL_LOG_PREVIEW_LIMIT } from "../constants";


import { api } from "../api";
import { formatDateTime, formatCompactDateTime, getCompactRepoStatusLabel, formatCompactSyncMessage } from "../utils/formatters";
import { getRepositoryMeta, getRepositoryOwnershipLabel, getRepositoryOwnershipTone, sortRepositoriesByStatus } from "../utils/repoHelpers";
import { toneFromLogLevel } from "../utils/taskHelpers";
import { parseTaskLog } from "../utils/logParser";
import type { LogLevelFilter } from "../context/AppContext";

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
    repositories, groups, settings, selectedRepo, repoForm,
    busyAction, repoDetailOpen,
    openRepoDetail, closeRepoDetail,
    handleSync, handleForceSync, handleRefresh,
    handleSaveRepository, handleRemoveRepository,
    handleExportRepositoryLog,
    pickFolder, copyText, setRepoForm
  } = useApp();

  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];

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
    if (!selectedRepoId) { setRepoLogContent(""); return; }
    let cancelled = false;
    api.getRepositoryLog(selectedRepoId).then((log) => { if (!cancelled) setRepoLogContent(log); }).catch(() => { if (!cancelled) setRepoLogContent(""); });
    return () => { cancelled = true; };
  }, [selectedRepoId]);

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

  const repoGroupOptions = useMemo(() => Array.from(new Set(repositories.map((r) => r.group).filter(Boolean))), [repositories]);

  // Initialize repoForm when selectedRepo changes in detail view
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

  // Repository detail view
  if (repoDetailOpen && selectedRepo && repoForm) {
    return (
      <section className="card panel">
        <div className="panel-header">
          <div>
            <button className="text-link-button" onClick={closeRepoDetail}>{text.repoDetail.back}</button>
            <h3>{selectedRepo.name}</h3>
            <p className="muted">独立详情视图承接编辑、日志与快捷操作。</p>
          </div>
          <div className="summary-row wrap">
            <Badge tone={getRepositoryOwnershipTone(selectedRepo.ownership)} text={getRepositoryOwnershipLabel(selectedRepo.ownership)} />
            <Badge tone={getRepositoryMeta(selectedRepo, settings).tone} text={getRepositoryMeta(selectedRepo, settings).label} />
          </div>
        </div>

        <div className="view-stack">
          <div className="summary-row wrap">
            <SummaryPill label="ahead" value={selectedRepo.status.aheadCount} tone="neutral" />
            <SummaryPill label="behind" value={selectedRepo.status.behindCount} tone="pending" />
            <SummaryPill label="本地改动" value={selectedRepo.status.hasUncommittedChanges ? "有" : "无"} tone={selectedRepo.status.hasUncommittedChanges ? "warning" : "success"} />
            <SummaryPill label="启用" value={repoForm.enabled ? "是" : "否"} tone={repoForm.enabled ? "success" : "neutral"} />
          </div>
          <div className="form-grid two-columns">
            <label><span>仓库名称</span><input value={repoForm.name} onChange={(e) => setRepoForm((c) => c ? { ...c, name: e.target.value } : c)} /></label>
            <label>
              <span>分组</span>
              <input list="repo-group-options" value={repoForm.group} onChange={(e) => setRepoForm((c) => c ? { ...c, group: e.target.value } : c)} placeholder="选择或输入分组" />
              <datalist id="repo-group-options">{repoGroupOptions.map((g) => <option key={g} value={g} />)}</datalist>
            </label>
            <label>
              <span>仓库归属</span>
              <select value={repoForm.ownership} onChange={(e) => setRepoForm((c) => c ? { ...c, ownership: e.target.value as typeof c.ownership } : c)}>
                <option value="unassigned">未标注</option>
                <option value="mine">我的</option>
                <option value="other">其他作者</option>
              </select>
            </label>
            <label className="full-span">
              <span>仓库路径</span>


              <div className="path-input">
                <input value={repoForm.path} onChange={(e) => setRepoForm((c) => c ? { ...c, path: e.target.value } : c)} />
                <button type="button" className="ghost-button" onClick={() => void pickFolder((v) => setRepoForm((c) => c ? { ...c, path: v } : c))}>选择目录</button>
              </div>
            </label>
            <label className="full-span"><span>备注</span><textarea value={repoForm.note} onChange={(e) => setRepoForm((c) => c ? { ...c, note: e.target.value } : c)} rows={3} /></label>
            <label className="switch-row">
              <input type="checkbox" checked={repoForm.enabled} onChange={(e) => setRepoForm((c) => c ? { ...c, enabled: e.target.checked } : c)} />
              <span>启用该仓库参与同步</span>
            </label>
          </div>
          <div className="info-grid compact">
            <InfoField label="remote URL" value={selectedRepo.remoteUrl || "-"} />
            <InfoField label="仓库归属" value={getRepositoryOwnershipLabel(selectedRepo.ownership)} />
            <InfoField label="当前分支" value={selectedRepo.status.currentBranch || "-"} />
            <InfoField label="upstream" value={selectedRepo.status.upstreamName || "未配置"} />
            <InfoField label="最近同步" value={formatDateTime(selectedRepo.lastSyncAt)} />
            <InfoField label="最近结果" value={selectedRepo.lastSyncMessage || "-"} />
            <InfoField label="状态说明" value={selectedRepo.status.statusText || "-"} />
          </div>
          <div className="inline-actions wrap">
            <button className="primary-button" onClick={() => void handleSaveRepository()} disabled={busyAction === "repo-save"}>保存信息</button>
            <button className="ghost-button" onClick={() => void handleSync([selectedRepo.id])}>立即同步</button>
            <button className="ghost-button" onClick={() => { if (window.confirm("强制同步将覆盖本地更改，确定继续吗？")) void handleForceSync([selectedRepo.id]); }}>强制同步</button>
            <button className="ghost-button" onClick={() => void handleRefresh([selectedRepo.id])}>{busyAction === "refresh" ? <><span className="inline-spinner"></span>刷新中...</> : "刷新状态"}</button>
            <button className="ghost-button" onClick={() => void api.openExternal(repoForm.path)} disabled={!repoForm.path.trim()}>打开目录</button>
            <button className="ghost-button" onClick={() => void copyText(repoForm.path, "路径已复制")}>复制路径</button>
            <button className="danger-button" onClick={() => void handleRemoveRepository()} disabled={busyAction === "repo-remove"}>移除仓库</button>
          </div>
          <section className="inset-card">
            <div className="panel-header mini">
              <div><h4>同步日志</h4><p className="muted">当前仓库历史日志</p></div>
              <div className="inline-actions wrap">
                <button className="ghost-button" onClick={() => void copyText(filteredRepoLogLines.map((l) => l.text).join("\n") || selectedRepoLog, "仓库日志已复制")}>复制日志</button>
                <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={busyAction === "export-repo-log"}>导出日志</button>
              </div>
            </div>
            <div className="task-log-toolbar">
              <label className="search-box compact-search"><input value={repoLogSearch} onChange={(e) => setRepoLogSearch(e.target.value)} placeholder="搜索仓库日志、错误码" /></label>
              <select value={repoLogLevelFilter} onChange={(e) => setRepoLogLevelFilter(e.target.value as LogLevelFilter)}>
                <option value="all">全部日志</option>
                <option value="warning">仅警告</option>
                <option value="error">仅错误</option>
              </select>
            </div>
            {selectedRepoLog.trim() ? <p className="helper">为避免超长日志导致界面卡死，仅展示最近 {REPO_DETAIL_LOG_PREVIEW_LIMIT} 条结果。</p> : null}
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
          <div className="tab-bar-with-action">
            <TabBar items={[{ key: "all", label: `全部 (${repositories.length})` }, ...groups.map((g) => ({ key: g, label: g }))]} activeKey={repositoryGroupTab} onChange={setRepositoryGroupTab} />
            <button className="ghost-button tab-add-button" title="新建分组" onClick={() => { const name = window.prompt("请输入新分组名称"); if (name?.trim()) setRepositoryGroupTab(name.trim()); }}>+</button>
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
                    <Badge tone={meta.tone} text={getCompactRepoStatusLabel(meta.label)} />
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
          <div className="filters-row">
            <label className="search-box compact-search"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索 名称 / 路径 / 分支" /></label>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">全部组</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statusFilterOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
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
              <span>仓库</span><span>归属</span><span>组</span><span>分支</span><span>同步</span><span>结果</span><span>状态</span>
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
                          <span title={meta.label}><Badge tone={meta.tone} text={getCompactRepoStatusLabel(meta.label)} /></span>
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
          <div className="task-log-toolbar">
            <select value={selectedRepoId} onChange={(e) => setSelectedRepoId(e.target.value)}>
              <option value="">全部日志</option>
              {repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}
            </select>
            <button className="ghost-button" onClick={() => void handleExportRepositoryLog()} disabled={!selectedRepo || busyAction === "export-repo-log"}>导出日志</button>
          </div>
          <div className="task-log-toolbar">
            <label className="search-box compact-search"><input value={repoLogSearch} onChange={(e) => setRepoLogSearch(e.target.value)} placeholder="搜索仓库日志" /></label>
            <select value={repoLogLevelFilter} onChange={(e) => setRepoLogLevelFilter(e.target.value as LogLevelFilter)}>
              <option value="all">全部日志</option>
              <option value="warning">仅警告</option>
              <option value="error">仅错误</option>
            </select>
          </div>
          {selectedRepoLog.trim() ? <p className="helper">为避免超长日志导致界面卡死，仅解析最近 {LOG_PARSE_MAX_LINES} 行，并对超长单行进行安全截断。</p> : null}
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
  );
}
