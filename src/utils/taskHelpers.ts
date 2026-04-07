import type { SyncTaskRecord, SyncTaskItemResult, RepoTone } from "../types";

/**
 * 从任务项状态获取显示色调
 */
export function toneFromTaskState(state: string): RepoTone {
  if (state === "success") return "success";
  if (state === "skipped") return "warning";
  if (state === "failed") return "danger";
  if (state === "cancelled") return "neutral";
  return "neutral";
}

/**
 * 从任务记录获取显示色调
 */
export function toneFromTaskRecord(task: SyncTaskRecord): RepoTone {
  if (task.running && task.cancelRequested) return "warning";
  if (task.running) return "pending";
  if (task.cancelled) return "neutral";
  if (task.failedCount > 0) return "danger";
  if (task.skippedCount > 0) return "warning";
  if (task.successCount > 0) return "success";
  return "neutral";
}

/**
 * 从日志级别获取显示色调
 */
export function toneFromLogLevel(level: "info" | "warning" | "error"): RepoTone {
  if (level === "error") return "danger";
  if (level === "warning") return "warning";
  return "neutral";
}

/**
 * 获取任务模式标签
 */
export function getTaskModeLabel(mode: string): string {
  switch (mode) {
    case "all": return "同步全部";
    case "group": return "分组同步";
    case "selected": return "选中同步";
    case "force-all": return "强制同步全部";
    case "force-group": return "强制分组同步";
    case "force-selected": return "强制选中同步";
    default: return "选中同步";
  }
}

/**
 * 获取任务状态标签
 */
export function getTaskStatusLabel(task: SyncTaskRecord): string {
  if (task.running && task.cancelRequested) return "取消中";
  if (task.running) return "运行中";
  if (task.cancelled) return "已取消";
  if (task.failedCount === task.total && task.total > 0) return "全部失败";
  if (task.failedCount > 0) return "部分失败";
  return "已完成";
}

/**
 * 获取任务状态提示
 */
export function getTaskStatusHint(task: SyncTaskRecord, currentRepoName?: string): string {
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
      ? `该任务已取消，已有 ${task.cancelledCount} 个仓库被标记为"已取消"。`
      : "该任务已取消。";
  }
  return "";
}

/**
 * 构建任务摘要文本
 */
export function buildTaskSummary(task: SyncTaskRecord): string {
  const header = [
    `任务 ID：${task.taskId}`,
    `任务模式：${getTaskModeLabel(task.mode)}`,
    `任务状态：${getTaskStatusLabel(task)}`,
    `开始时间：${task.startTime}`,
    `结束时间：${task.endTime}`,
    `摘要：${task.summaryMessage}`
  ];

  const items = prioritizeTaskItems(task.items).map((item) => {
    const code = item.code ? ` · ${item.code}` : "";
    return `${item.repoName} · ${item.title}${code} · ${item.detail}`;
  });

  return [...header, "", ...items].join("\n");
}

/**
 * 聚合任务错误码
 */
export function aggregateTaskCodes(items: SyncTaskItemResult[]): Array<{ code: string; count: number }> {
  const counter = new Map<string, number>();
  items.forEach((item) => {
    if (!item.code) return;
    counter.set(item.code, (counter.get(item.code) ?? 0) + 1);
  });
  return [...counter.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * 优先排序任务项（失败 > 取消 > 跳过 > 成功）
 */
export function prioritizeTaskItems(items: SyncTaskItemResult[]): SyncTaskItemResult[] {
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

/**
 * 合并任务列表
 */
export function mergeTasks(tasks: SyncTaskRecord[], next: SyncTaskRecord): SyncTaskRecord[] {
  return [next, ...tasks.filter((task) => task.taskId !== next.taskId)].sort((a, b) =>
    b.startTime.localeCompare(a.startTime)
  );
}
