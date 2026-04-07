import type { CSSProperties, KeyboardEvent } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList } from "react-window";
import { Badge, EmptyState } from "../index";
import type { SyncTaskRecord } from "../../types";
import { formatDateTime, formatDuration } from "../../utils/formatters";
import { getTaskModeLabel, getTaskStatusHint, getTaskStatusLabel, toneFromTaskRecord } from "../../utils/taskHelpers";

const TASK_HISTORY_ROW_HEIGHT = 132;

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
  activeTaskId,
  currentTaskRepoName,
  selectedTaskId,
  busyAction,
  onOpenTaskDetail,
  onRequestCancel
}: TaskHistoryVirtualListProps) {
  if (!tasks.length) {
    return <EmptyState title="暂无历史任务记录" description="可调整筛选条件，或执行一次新的同步任务。" />;
  }

  return (
    <div className="theme-elevated-block" style={{ height: 560 }}>

      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <FixedSizeList height={height} width={width} itemCount={tasks.length} itemSize={TASK_HISTORY_ROW_HEIGHT} overscanCount={6}>
            {({ index, style }: { index: number; style: CSSProperties }) => {
              const task = tasks[index];
              const taskStatusHint = task.taskId === activeTaskId ? getTaskStatusHint(task, currentTaskRepoName) : getTaskStatusHint(task);
              const isSelected = selectedTaskId === task.taskId;
              const isCancelling = busyAction === "cancel-task" && task.cancelRequested;

              const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenTaskDetail(task.taskId);
                }
              };

              return (
                <div style={style} className="pb-3">
                  <div
                    className={`task-item interactive ${isSelected ? "active" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenTaskDetail(task.taskId)}
                    onKeyDown={handleKeyDown}
                  >
                    <div className="task-item-main">
                      <div className="task-item-head">
                        <strong>{getTaskModeLabel(task.mode)}</strong>
                        <Badge tone={toneFromTaskRecord(task)} text={getTaskStatusLabel(task)} />
                      </div>
                      <p className="muted">{formatDateTime(task.startTime)} · {task.summaryMessage}</p>
                      {taskStatusHint ? <p className="helper">{taskStatusHint}</p> : null}
                      <div className="task-item-meta">
                        <span>任务 ID：{task.taskId}</span>
                        <span>目标仓库：{task.total}</span>
                        <span>耗时：{formatDuration(task.items.reduce((sum, item) => sum + item.durationMs, 0))}</span>
                      </div>
                    </div>
                    <div className="task-item-side">
                      <div className="task-metrics">
                        <Badge tone="success" text={`成功 ${task.successCount}`} />
                        <Badge tone="warning" text={`跳过 ${task.skippedCount}`} />
                        <Badge tone="danger" text={`失败 ${task.failedCount}`} />
                        {task.cancelledCount > 0 ? <Badge tone="neutral" text={`取消 ${task.cancelledCount}`} /> : null}
                      </div>
                      {task.running ? (
                        <button
                          className="ghost-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRequestCancel(task.taskId);
                          }}
                          onKeyDown={(event) => event.stopPropagation()}
                          disabled={task.cancelRequested || busyAction === "cancel-task"}
                        >
                          {isCancelling || task.cancelRequested ? "取消中..." : "取消任务"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            }}
          </FixedSizeList>
        )}
      </AutoSizer>
    </div>
  );
}
