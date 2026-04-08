import type { AppSettings, RepositoryOwnership, RepositoryRecord, RepoTone } from "../types";

const OWNERSHIP_LABELS: Record<RepositoryOwnership, string> = {
  mine: "我的",
  other: "其他作者",
  unassigned: "未标注"
};

export function getRepositoryMeta(repo: RepositoryRecord, settings: AppSettings): { tone: RepoTone; label: string } {
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
    return { tone: "warning", label: "存在未跟踪文件" };
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
    const skipReasonResolved =
      !repo.status.hasUncommittedChanges &&
      !(settings.skipUntrackedFiles && repo.status.hasUntrackedFiles) &&
      !repo.status.detachedHead &&
      !repo.status.inProgressOperation &&
      repo.status.upstreamConfigured;

    if (skipReasonResolved) {
      if (repo.status.syncRequired) {
        return { tone: "pending", label: `待同步 · behind ${repo.status.behindCount}` };
      }
      return { tone: "success", label: "状态正常" };
    }
    return { tone: "warning", label: "已跳过" };
  }
  if (repo.lastSyncStatus === "success") {
    return { tone: "success", label: "已同步" };
  }
  return { tone: "success", label: "状态正常" };
}

export function getRepositoryOwnershipLabel(ownership: RepositoryOwnership): string {
  return OWNERSHIP_LABELS[ownership] ?? OWNERSHIP_LABELS.unassigned;
}

export function getRepositoryOwnershipTone(ownership: RepositoryOwnership): RepoTone {
  if (ownership === "mine") return "success";
  if (ownership === "other") return "pending";
  return "neutral";
}

export type OverviewStatusFilter = "all" | "success" | "failed" | "warning" | "pending";

export function matchesOverviewStatusFilter(
  repo: RepositoryRecord,
  filter: OverviewStatusFilter,
  settings: AppSettings
): boolean {
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

export function sortRepositories(repositories: RepositoryRecord[]): RepositoryRecord[] {
  return [...repositories].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

const TONE_PRIORITY: Record<RepoTone, number> = {
  danger: 0,
  warning: 1,
  pending: 2,
  success: 3,
  neutral: 4
};

export function sortRepositoriesByStatus(
  repositories: RepositoryRecord[],
  settings: AppSettings
): RepositoryRecord[] {
  return [...repositories].sort((a, b) => {
    const metaA = getRepositoryMeta(a, settings);
    const metaB = getRepositoryMeta(b, settings);
    const priorityA = TONE_PRIORITY[metaA.tone] ?? 4;
    const priorityB = TONE_PRIORITY[metaB.tone] ?? 4;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}
