import { useMemo, useState, useEffect } from "react";
import { TabBar, SummaryPill, Badge, EmptyState, Modal } from "../components";
import { TaskHistoryVirtualList, TaskLogVirtualList } from "../components/tasks";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "../components/ui/alert-dialog";
import { useApp } from "../context/AppContext";
import { UI_TEXT, LOG_PARSE_MAX_LINES, LOG_LINE_TEXT_MAX_LENGTH } from "../constants";
import { api } from "../api";
import { formatDateTime } from "../utils/formatters";
import { toneFromTaskState, toneFromTaskRecord, getTaskModeLabel, getTaskStatusLabel, getTaskStatusHint, prioritizeTaskItems } from "../utils/taskHelpers";
import { parseTaskLog } from "../utils/logParser";

export function TasksPage() {
  const {
    taskTab, setTaskTab,
    taskSearch, setTaskSearch,
    taskResultFilter, setTaskResultFilter,
    taskDateFilter, setTaskDateFilter,
    taskLogSearch, setTaskLogSearch,
    taskLogLevelFilter, setTaskLogLevelFilter,
    selectedTaskId, setSelectedTaskId,
    tasks, activeTask, selectedTask, currentTaskRepoName,
    openRepoDetail, openTaskDetail, taskDetailModalOpen, setTaskDetailModalOpen,
    handleCancelTask, handleExportTaskLog, busyAction
  } = useApp();

  const settings = useApp().settings;
  const text = UI_TEXT[settings.languageMode === "en-US" ? "en-US" : "zh-CN"];
  const [pendingCancelTaskId, setPendingCancelTaskId] = useState<string | null>(null);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (taskSearch) {
        const query = taskSearch.toLowerCase();
        if (!task.summaryMessage.toLowerCase().includes(query) &&
            !task.taskId.toLowerCase().includes(query) &&
            !task.items.some((item) => item.repoName.toLowerCase().includes(query))) {
          return false;
        }
      }
      if (taskResultFilter === "failed" && task.failedCount === 0) return false;
      if (taskResultFilter === "warning" && task.skippedCount === 0 && task.cancelledCount === 0) return false;
      if (taskResultFilter === "success" && (task.failedCount > 0 || task.skippedCount > 0)) return false;
      if (taskDateFilter) {
        const taskDate = task.startTime.slice(0, 10);
        if (taskDate !== taskDateFilter) return false;
      }
      return true;
    });
  }, [tasks, taskSearch, taskResultFilter, taskDateFilter]);

  const [taskLogContent, setTaskLogContent] = useState("");
  useEffect(() => {
    const taskId = selectedTask?.taskId;
    if (!taskId) { setTaskLogContent(""); return; }
    let cancelled = false;
    api.getTaskLog(taskId).then((log) => { if (!cancelled) setTaskLogContent(log); }).catch(() => { if (!cancelled) setTaskLogContent(""); });
    return () => { cancelled = true; };
  }, [selectedTask?.taskId]);

  const selectedTaskLog = taskLogContent;
  const parsedLogLines = useMemo(() => parseTaskLog(selectedTaskLog, {
    maxLines: LOG_PARSE_MAX_LINES,
    maxLineLength: LOG_LINE_TEXT_MAX_LENGTH
  }), [selectedTaskLog]);
  const filteredLogLines = useMemo(() => {
    return parsedLogLines.filter((line) => {
      if (taskLogSearch) {
        const query = taskLogSearch.toLowerCase();
        if (!line.text.toLowerCase().includes(query) &&
            !(line.repoName?.toLowerCase().includes(query)) &&
            !(line.code?.toLowerCase().includes(query))) {
          return false;
        }
      }
      if (taskLogLevelFilter === "warning" && line.level !== "warning") return false;
      if (taskLogLevelFilter === "error" && line.level !== "error") return false;
      return true;
    });
  }, [parsedLogLines, taskLogSearch, taskLogLevelFilter]);

  const syncProgress = activeTask && activeTask.total > 0 ? (activeTask.completed / activeTask.total) * 100 : 0;
  const activeTaskStatusHint = activeTask ? getTaskStatusHint(activeTask, currentTaskRepoName) : "";
  const pendingCancelTask = pendingCancelTaskId ? tasks.find((task) => task.taskId === pendingCancelTaskId) ?? (activeTask?.taskId === pendingCancelTaskId ? activeTask : null) : null;

  return (
    <>
      <section className="card panel">
        <TabBar
          items={[
            { key: "overview", label: text.taskTabs.overview },
            { key: "history", label: text.taskTabs.history },
            { key: "logs", label: text.taskTabs.logs }
          ]}
          activeKey={taskTab}
          onChange={(key) => setTaskTab(key as "overview" | "history" | "logs")}
        />

        {taskTab === "overview" ? (
          <div className="view-stack">
            <section className="inset-card">
              <div className="panel-header mini">
                <div><h4>当前任务</h4></div>
                {activeTask ? <Badge tone={toneFromTaskRecord(activeTask)} text={getTaskStatusLabel(activeTask)} /> : null}
              </div>
              {activeTask ? (
                <>
                  <div className="progress-bar"><span style={{ width: `${syncProgress}%` }} /></div>
                  <p>{activeTask.summaryMessage}</p>
                  <div className="summary-row wrap">
                    <SummaryPill label="成功" value={activeTask.successCount} tone="success" />
                    <SummaryPill label="跳过" value={activeTask.skippedCount} tone="warning" />
                    <SummaryPill label="失败" value={activeTask.failedCount} tone="danger" />
                    {activeTask.cancelRequested || activeTask.cancelledCount > 0 ? (
                      <SummaryPill label="取消" value={activeTask.cancelledCount} tone="neutral" />
                    ) : null}
                  </div>
                  {activeTaskStatusHint ? <p className="helper">{activeTaskStatusHint}</p> : null}
                  <div className="stack-list compact-list">
                    {(() => {
                      const runningItem = activeTask.items.find((item) => item.state === "checking" || item.state === "fetching" || item.state === "pulling" || item.state === "comparing");
                      const completedItems = prioritizeTaskItems(activeTask.items.filter((item) => item.state !== "checking" && item.state !== "fetching" && item.state !== "pulling" && item.state !== "comparing"));
                      return (
                        <>
                          {runningItem ? (
                            <div key={`${runningItem.repoId}-running`} className="list-item preview-item sync-progress-item running task-item-enter">
                              <div className="summary-row wrap">
                                <span className="repo-name"><span className="inline-spinner"></span>{runningItem.repoName}</span>
                                <Badge tone="pending" text="执行中..." />
                              </div>
                              <p className="muted">正在处理...</p>
                            </div>
                          ) : null}
                          {completedItems.slice(0, 5).map((item, index) => (
                            <div key={`${item.repoId}-${item.finishedAt}`} className="list-item preview-item sync-progress-item task-item-enter" style={{ animationDelay: `${index * 0.05}s` }}>
                              <div className="summary-row wrap">
                                <button className="text-link-button" onClick={() => openRepoDetail(item.repoId, "tasks")}>{item.repoName}</button>
                                <Badge tone={toneFromTaskState(item.state)} text={item.title} />
                              </div>
                              <p className="muted">{item.detail}</p>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <EmptyState title="暂无任务记录" description="点击顶部「同步全部」后，这里会出现最近运行摘要。" />
              )}
              <div className="inline-actions wrap">
                <button className="ghost-button" onClick={() => setPendingCancelTaskId(activeTask?.taskId ?? null)} disabled={!activeTask?.running || activeTask.cancelRequested || busyAction === "cancel-task"}>
                  {activeTask?.cancelRequested ? "正在取消..." : "取消当前任务"}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {taskTab === "history" ? (
          <div className="view-stack">
            <div className="task-toolbar theme-elevated-block">

              <label className="search-box compact-search">
                <input value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} placeholder="搜索任务摘要、任务 ID、仓库名" />
              </label>
              <select value={taskResultFilter} onChange={(e) => setTaskResultFilter(e.target.value as "all" | "failed" | "warning" | "success")}>
                <option value="all">全部结果</option>
                <option value="failed">有失败</option>
                <option value="warning">有跳过/取消</option>
                <option value="success">全成功</option>
              </select>
              <input type="date" value={taskDateFilter} onChange={(e) => setTaskDateFilter(e.target.value)} />
            </div>
            <TaskHistoryVirtualList
              tasks={filteredTasks}
              activeTaskId={activeTask?.taskId}
              currentTaskRepoName={currentTaskRepoName ?? undefined}

              selectedTaskId={selectedTaskId}
              busyAction={busyAction ?? undefined}

              onOpenTaskDetail={openTaskDetail}
              onRequestCancel={(taskId) => setPendingCancelTaskId(taskId)}
            />
          </div>
        ) : null}

        {taskTab === "logs" ? (
          <div className="view-stack">
            <div className="task-log-toolbar theme-elevated-block">
              <select value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}>
                {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{formatDateTime(task.startTime)} · {getTaskModeLabel(task.mode)}</option>)}
              </select>
              <button className="ghost-button" onClick={() => void handleExportTaskLog()} disabled={!selectedTask || busyAction === "export-task-log"}>导出日志</button>
            </div>
            <div className="task-log-toolbar theme-elevated-block">
              <label className="search-box compact-search">
                <input value={taskLogSearch} onChange={(e) => setTaskLogSearch(e.target.value)} placeholder="搜索日志、仓库名、错误码" />
              </label>
              <select value={taskLogLevelFilter} onChange={(e) => setTaskLogLevelFilter(e.target.value as "all" | "warning" | "error")}>
                <option value="all">全部日志</option>
                <option value="warning">仅警告</option>
                <option value="error">仅错误</option>
              </select>
            </div>
            <TaskLogVirtualList selectedTaskLog={selectedTaskLog} parsedLogLines={parsedLogLines} filteredLogLines={filteredLogLines} />
          </div>
        ) : null}


        <Modal open={taskDetailModalOpen} title="任务详情" onClose={() => setTaskDetailModalOpen(false)}>
          {selectedTask ? (
            <div className="view-stack">
              <div className="info-grid compact">
                <div className="info-field"><span>任务 ID</span><strong>{selectedTask.taskId}</strong></div>
                <div className="info-field"><span>任务模式</span><strong>{getTaskModeLabel(selectedTask.mode)}</strong></div>
                <div className="info-field"><span>任务状态</span><strong>{getTaskStatusLabel(selectedTask)}</strong></div>
                <div className="info-field"><span>开始时间</span><strong>{formatDateTime(selectedTask.startTime)}</strong></div>
                <div className="info-field"><span>结束时间</span><strong>{formatDateTime(selectedTask.endTime)}</strong></div>
              </div>
              <p>{selectedTask.summaryMessage}</p>
            </div>
          ) : (
            <EmptyState title="未选择任务" description="请从任务列表选择一个任务查看详情。" />
          )}
          <div className="modal-footer">
            <button className="ghost-button" onClick={() => setTaskDetailModalOpen(false)}>关闭</button>
          </div>
        </Modal>
      </section>

      <AlertDialog open={!!pendingCancelTaskId} onOpenChange={(open) => { if (!open) setPendingCancelTaskId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消当前任务？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingCancelTask
                ? `任务 ${pendingCancelTask.taskId} 正在执行中。确认后会请求停止当前同步流程，可能需要等待正在执行的仓库完成当前命令。`
                : "确认后会请求停止当前同步流程，可能需要等待正在执行的仓库完成当前命令。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="ghost-button" onClick={() => setPendingCancelTaskId(null)}>继续执行</AlertDialogCancel>
            <AlertDialogAction
              className="danger-button"
              onClick={() => {
                const taskId = pendingCancelTaskId;
                setPendingCancelTaskId(null);
                if (taskId) {
                  void handleCancelTask(taskId);
                }
              }}
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

