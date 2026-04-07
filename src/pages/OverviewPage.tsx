import { useMemo } from "react";
import { TabBar, SummaryPill, Badge, EmptyState } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT } from "../constants";
import { formatDateTime, formatDuration } from "../utils/formatters";
import { getRepositoryMeta, getRepositoryOwnershipLabel, getRepositoryOwnershipTone, type OverviewStatusFilter } from "../utils/repoHelpers";
import { prioritizeTaskItems } from "../utils/taskHelpers";

export function OverviewPage() {
  const {
    overviewTab, setOverviewTab,
    overviewStatusFilter, setOverviewStatusFilter,
    repositories, settings, latestTask, openRepoDetail
  } = useApp();

  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];

  const overviewRepositories = useMemo(() => {
    const filtered = repositories.filter((repo) => {
      if (overviewStatusFilter === "all") return true;
      const meta = getRepositoryMeta(repo, settings);
      if (overviewStatusFilter === "pending") return repo.status.syncRequired;
      if (overviewStatusFilter === "failed") return meta.tone === "danger";
      if (overviewStatusFilter === "warning") return meta.tone === "warning";
      if (overviewStatusFilter === "success") return meta.tone === "success";
      return true;
    });

    return filtered.sort((a, b) => {
      const metaA = getRepositoryMeta(a, settings);
      const metaB = getRepositoryMeta(b, settings);
      const priority = { danger: 0, warning: 1, pending: 2, success: 3, neutral: 4 };
      const priorityA = metaA.tone in priority ? priority[metaA.tone as keyof typeof priority] : 4;
      const priorityB = metaB.tone in priority ? priority[metaB.tone as keyof typeof priority] : 4;

      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name);
    });
  }, [repositories, overviewStatusFilter, settings]);

  const recentFailedItems = useMemo(() => {
    if (!latestTask) return [];
    return prioritizeTaskItems(latestTask.items.filter((item) => item.state === "failed")).slice(0, 5);
  }, [latestTask]);

  const nextSyncRepositories = useMemo(() => {
    return repositories
      .filter((repo) => repo.enabled && repo.status.syncRequired)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 4);
  }, [repositories]);

  const failedRepositoriesForAction = useMemo(() => {
    return overviewRepositories
      .filter((repo) => getRepositoryMeta(repo, settings).tone === "danger")
      .slice(0, 4);
  }, [overviewRepositories, settings]);

  const successCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "success").length;
  const failedCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "danger").length;
  const warningCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "warning").length;
  const pendingCount = repositories.filter((repo) => repo.status.syncRequired).length;

  const latestTaskTone = latestTask
    ? latestTask.running
      ? "pending"
      : latestTask.failedCount > 0
        ? "danger"
        : "success"
    : "neutral";

  const latestTaskStatusText = latestTask
    ? latestTask.running
      ? "进行中"
      : latestTask.failedCount > 0
        ? "失败"
        : "已完成"
    : "暂无任务";

  const latestTaskProgressText = latestTask
    ? latestTask.running
      ? `进度 ${latestTask.completed}/${latestTask.total || 0}`
      : `共处理 ${latestTask.total || 0} 个仓库`
    : "";

  return (
    <section className="card panel">
      <TabBar
        items={[
          { key: "status", label: text.overviewTabs.status },
          { key: "summary", label: text.overviewTabs.summary }
        ]}
        activeKey={overviewTab}
        onChange={(key) => setOverviewTab(key as "status" | "summary")}
      />

      {overviewTab === "status" ? (
        <div className="view-stack">
          <div className="metric-grid overview-metric-grid">
            {[
              { key: "all", label: "仓库总数", value: repositories.length, tone: "neutral" as const },
              { key: "success", label: "成功", value: successCount, tone: "success" as const },
              { key: "failed", label: "失败", value: failedCount, tone: "danger" as const },
              { key: "warning", label: "跳过", value: warningCount, tone: "warning" as const },
              { key: "pending", label: "待同步", value: pendingCount, tone: "pending" as const }
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
                      <Badge tone={getRepositoryOwnershipTone(repo.ownership)} text={getRepositoryOwnershipLabel(repo.ownership)} />
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
            <section className="inset-card overview-summary-card">
              <div className="panel-header mini">
                <div>
                  <h4>最近一次同步</h4>
                </div>
              </div>
              {latestTask ? (
                <div className="overview-latest-task">
                  <div className="summary-row wrap overview-status-row">
                    <Badge tone={latestTaskTone} text={latestTaskStatusText} />
                    <span className="helper">{formatDateTime(latestTask.startTime)}</span>
                    <span className="helper">耗时 {formatDuration(latestTask.items.reduce((sum, item) => sum + item.durationMs, 0))}</span>
                    {latestTaskProgressText ? <span className="helper">{latestTaskProgressText}</span> : null}
                  </div>
                  {latestTask.running && latestTask.total > 0 ? (
                    <div className="progress-bar overview-progress-bar">
                      <span style={{ width: `${Math.max(0, Math.min(100, (latestTask.completed / latestTask.total) * 100))}%` }} />
                    </div>
                  ) : null}
                  <div className="summary-row wrap overview-summary-pills">
                    <SummaryPill label="成功" value={latestTask.successCount} tone="success" />
                    <SummaryPill label="跳过" value={latestTask.skippedCount} tone="warning" />
                    <SummaryPill label="失败" value={latestTask.failedCount} tone="danger" />
                  </div>
                </div>
              ) : (
                <EmptyState title="暂无任务摘要" description="执行一次同步后，这里会显示最近运行摘要。" />
              )}
            </section>
            <section className="inset-card overview-summary-card">
              <div className="panel-header mini">
                <div>
                  <h4>最近失败仓库</h4>
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
          <section className="inset-card overview-summary-card">
            <div className="panel-header mini">
              <div>
                <h4>待处理与快捷处理</h4>
              </div>
            </div>
            <div className="panel-grid two-columns overview-action-grid">
              <div className="stack-list compact-list">
                <div className="overview-section-label">待处理仓库</div>
                {nextSyncRepositories.map((repo) => (
                  <article key={repo.id} className="list-item preview-item overview-action-item">
                    <div className="summary-row wrap overview-action-head">
                      <div className="overview-action-title">
                        <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "overview")}>{repo.name}</button>
                        <Badge tone={getRepositoryOwnershipTone(repo.ownership)} text={getRepositoryOwnershipLabel(repo.ownership)} />
                        <Badge tone="pending" text="待同步" />
                      </div>
                      <button className="ghost-button compact" onClick={() => openRepoDetail(repo.id, "overview")}>查看详情</button>
                    </div>
                    <p className="muted">分支：{repo.status.currentBranch || "-"} · 最近同步：{formatDateTime(repo.lastSyncAt)}</p>
                  </article>
                ))}
                {!nextSyncRepositories.length ? <EmptyState title="当前没有待处理仓库" description="所有启用仓库都处于最新状态。" /> : null}
              </div>
              <div className="stack-list compact-list">
                <div className="overview-section-label">失败仓库快捷操作</div>
                {failedRepositoriesForAction.map((repo) => {
                  const meta = getRepositoryMeta(repo, settings);
                  return (
                    <article key={repo.id} className="list-item preview-item overview-action-item">
                      <div className="summary-row wrap overview-action-head">
                        <div className="overview-action-title">
                          <button className="text-link-button" onClick={() => openRepoDetail(repo.id, "overview")}>{repo.name}</button>
                          <Badge tone={getRepositoryOwnershipTone(repo.ownership)} text={getRepositoryOwnershipLabel(repo.ownership)} />
                          <Badge tone="danger" text={meta.label} />
                        </div>
                        <button className="ghost-button compact" onClick={() => openRepoDetail(repo.id, "overview")}>查看详情</button>
                      </div>
                      <p className="muted">分支：{repo.status.currentBranch || "-"} · 最近同步：{formatDateTime(repo.lastSyncAt)}</p>
                    </article>
                  );
                })}
                {!failedRepositoriesForAction.length ? <EmptyState title="当前没有失败仓库" description="最近同步结果正常，没有需要立即处理的失败项。" /> : null}
              </div>
            </div>
          </section>

        </div>
      )}
    </section>
  );
}

