import type { ImportStrategy, ConfigImportPreview } from "../types";

/**
 * 获取导入策略标签
 */
export function getImportStrategyLabel(strategy: ImportStrategy): string {
  return {
    merge: "合并导入",
    overwrite: "整体覆盖",
    repositoriesOnly: "仅导入仓库",
    settingsOnly: "仅导入设置"
  }[strategy];
}

/**
 * 获取导入策略描述
 */
export function getImportStrategyDescription(strategy: ImportStrategy): string {
  return {
    merge: "合并当前配置与导入包，适合日常迁移；任务摘要也会一并合并。",
    overwrite: "使用导入包整体替换当前设置、仓库与任务摘要，适合完整恢复。",
    repositoriesOnly: "只导入仓库清单，保留当前设备上的设置与任务摘要。",
    settingsOnly: "只导入应用设置，仓库列表与任务摘要保持不变。"
  }[strategy];
}

/**
 * 获取日志目录状态标签
 */
export function getLogsDirectoryStatusLabel(
  status: ConfigImportPreview["logsDirectoryStatus"],
  directory?: string | null
): string {
  if (status === "ok") {
    return directory ? `可用 · ${directory}` : "可用";
  }
  if (status === "invalid") {
    return directory ? `不可用 · ${directory}` : "不可用";
  }
  return "未包含自定义日志目录";
}
