import type { CSSProperties, KeyboardEvent } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList } from "react-window";
import { Badge, EmptyState } from "../index";
import type { SyncTaskRecord } from "../../types";
import { formatDateTime, formatDuration } from "../../utils/formatters";
import { getTaskModeLabel, getTaskStatusLabel, toneFromTaskRecord } from "../../utils/taskHelpers";

const TASK_HISTORY_ROW_HEIGHT = 74;

interface TaskHistoryVirtualListProps {
  tasks: SyncTaskRecord[];
  activeTaskId?: string;
  currentTaskRepoName?: string;
  selectedTaskId?: string;
  busyAction?: string;
  onOpenTaskDetail: (taskId: string) => void;
  onRequestCancel: (taskId: string) => void;
}

export function TaskHistoryVirtualList({
  tasks,
  selectedTaskId,
  busyAction,
  onOpenTaskDetail,
  onRequestCancel
}: TaskHistoryVirtualListProps) {
  if (!tasks.length) {
    return <EmptyState title="暂无历史任务记录" description="可调整筛选条件，或执行一次新的同步任务。" />;
  }

  return (
    <div className="theme-elevated-block task-history-list-shell">
      <div className="task-history-list-head">
        <span>任务时间</span>
        <span>类型</span>
        <span>摘要</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      <div className="task-history-list-body">
        <AutoSizer>
          {({ height, width }: { height: number; width: number }) => (
            <FixedSizeList height={height} width={width} itemCount={tasks.length} itemSize={TASK_HISTORY_ROW_HEIGHT} overscanCount={8}>
              {({ index, style }: { index: number; style: CSSProperties }) => {
                const task = tasks[index];
                const isSelected = selectedTaskId === task.taskId;
                const isCancelling = busyAction === "cancel-task" && task.cancelRequested;
                const durationMs = task.items.reduce((sum, item) => sum + item.durationMs, 0);

                const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenTaskDetail(task.taskId);
                  }
                };

                return (
                  <div style={style} className="task-history-row-wrap">
                    <div
                      className={`task-history-row ${isSelected ? "active" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenTaskDetail(task.taskId)}
                      onKeyDown={handleKeyDown}
                    >
                      <div className="task-history-primary">
                        <strong>{formatDateTime(task.startTime)}</strong>
                        <span className="muted task-history-secondary">{task.taskId}</span>
                      </div>
                      <div className="task-history-mode">
                        <strong>{getTaskModeLabel(task.mode)}</strong>
                        <span className="muted task-history-secondary">{formatDuration(durationMs)}</span>
                      </div>
                      <div className="task-history-summary">
                        <span className="task-history-summary-text" title={task.summaryMessage}>{task.summaryMessage}</span>
                        <span className="muted task-history-secondary">
                          {`成功 ${task.successCount} · 跳过 ${task.skippedCount} · 失败 ${task.failedCount}${task.cancelledCount > 0 ? ` · 取消 ${task.cancelledCount}` : ""}`}
                        </span>
                      </div>
                      <div className="task-history-status">
                        <Badge tone={toneFromTaskRecord(task)} text={getTaskStatusLabel(task)} />
                      </div>
                      <div className="task-history-actions">
                        {task.running ? (
                          <button
                            className="ghost-button compact"
                            onClick={(event) => {
                              event.stopPropagation();
                              onRequestCancel(task.taskId);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            disabled={task.cancelRequested || busyAction === "cancel-task"}
                          >
                            {isCancelling || task.cancelRequested ? "取消中..." : "取消"}
                          </button>
                        ) : (
                          <button
                            className="ghost-button compact"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenTaskDetail(task.taskId);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            详情
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }}
            </FixedSizeList>
          )}
        </AutoSizer>
      </div>
    </div>
  );
}
