/**
 * 日期时间格式化工具函数
 */

export function formatDateTime(value?: string | null): string {
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

export function formatCompactDateTime(value?: string | null): string {
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

export function formatDateKey(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 文件大小格式化
 */
export function formatBytes(bytes: number): string {
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

/**
 * 时长格式化
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  return `${(seconds / 60).toFixed(1)} min`;
}

/**
 * 同步消息压缩显示
 */
export function formatCompactSyncMessage(value?: string | null): string {
  if (!value) return "-";
  return value.replace(/。$/, "");
}

/**
 * 仓库状态标签压缩显示
 */
export function getCompactRepoStatusLabel(label: string): string {
  const pendingMatch = label.match(/^待同步\s*[·•]?\s*behind\s+(\d+)$/i);
  if (pendingMatch) {
    return `待同步 ${pendingMatch[1]}`;
  }
  const labelMap: Record<string, string> = {
    "仓库异常": "异常",
    "同步失败": "失败",
    "处理中断": "中断",
    "Detached HEAD": "游离头",
    "本地有改动": "改动",
    "未跟踪文件": "未跟踪",
    "未配置 upstream": "缺 upstream",
    "已取消": "取消",
    "已跳过": "跳过",
    "已同步": "已同步",
    "状态正常": "正常",
    "已禁用": "禁用"
  };
  return labelMap[label] ?? label;
}
