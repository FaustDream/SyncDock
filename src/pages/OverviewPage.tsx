import { useMemo } from "react";
import { TabBar, SummaryPill, Badge, EmptyState } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT } from "../constants";
import { formatDateTime, formatDuration } from "../utils/formatters";
import { getRepositoryMeta, type OverviewStatusFilter } from "../utils/repoHelpers";
import { toneFromTaskRecord, getTaskStatusLabel, prioritizeTaskItems } from "../utils/taskHelpers";

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

    // 排序：有问题的在上面，正常的在下面
    return filtered.sort((a, b) => {
      const metaA = getRepositoryMeta(a, settings);
      const metaB = getRepositoryMeta(b, settings);

      // 优先级：danger > warning > pending > success > neutral
      const priority = { danger: 0, warning: 1, pending: 2, success: 3, neutral: 4 };
      const priorityA = metaA.tone in priority ? priority[metaA.tone as keyof typeof priority] : 4;
      const priorityB = metaB.tone in priority ? priority[metaB.tone as keyof typeof priority] : 4;

      if (priorityA !== priorityB) return priorityA - priorityB;
      // 同优先级按名称排序
      return a.name.localeCompare(b.name);
    });
  }, [repositories, overviewStatusFilter, settings]);

  const recentFailedItems = useMemo(() => {
    if (!latestTask) return [];
    return prioritizeTaskItems(latestTask.items.filter((item) => item.state === "failed")).slice(0, 5);
  }, [latestTask]);

  const successCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "success").length;
  const failedCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "danger").length;
  const warningCount = repositories.filter((repo) => getRepositoryMeta(repo, settings).tone === "warning").length;
  const pendingCount = repositories.filter((repo) => repo.status.syncRequired).length;

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
          <div className="metric-grid">
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
                    <span className="helper">耗时 {formatDuration(latestTask.items.reduce((sum, item) => sum + item.durationMs, 0))}</span>
                  </div>
                  <div className="summary-row wrap">
                    <SummaryPill label="成功" value={latestTask.successCount} tone="success" />
                    <SummaryPill label="跳过" value={latestTask.skippedCount} tone="warning" />
                    <SummaryPill label="失败" value={latestTask.failedCount} tone="danger" />
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
  );
}
