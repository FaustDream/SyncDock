import { useMemo, useState, useEffect } from "react";
import { FixedSizeList } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { TabBar, SummaryPill, Badge, EmptyState, Modal } from "../components";
import { useApp } from "../context/AppContext";
import { UI_TEXT } from "../constants";
import { api } from "../api";
import { formatDateTime, formatDuration } from "../utils/formatters";
import { toneFromTaskState, toneFromTaskRecord, toneFromLogLevel, getTaskModeLabel, getTaskStatusLabel, getTaskStatusHint, prioritizeTaskItems } from "../utils/taskHelpers";
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
  const parsedLogLines = useMemo(() => parseTaskLog(selectedTaskLog), [selectedTaskLog]);
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

  return (
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
              <button className="ghost-button" onClick={() => void handleCancelTask()} disabled={!activeTask?.running || activeTask.cancelRequested || busyAction === "cancel-task"}>
                {activeTask?.cancelRequested ? "正在取消..." : "取消当前任务"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {taskTab === "history" ? (
        <div className="view-stack">
          <div className="task-toolbar">
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
          <div className="stack-list">
            {filteredTasks.map((task) => {
              const taskStatusHint = task.taskId === activeTask?.taskId ? getTaskStatusHint(task, currentTaskRepoName) : getTaskStatusHint(task);
              return (
                <div key={task.taskId} className={`task-item interactive ${selectedTaskId === task.taskId ? "active" : ""}`} role="button" tabIndex={0} onClick={() => openTaskDetail(task.taskId)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTaskDetail(task.taskId); } }}>
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
                      <button className="ghost-button" onClick={(e) => { e.stopPropagation(); void handleCancelTask(task.taskId); }} onKeyDown={(e) => e.stopPropagation()} disabled={task.cancelRequested || busyAction === "cancel-task"}>
                        {task.cancelRequested ? "取消中..." : "取消任务"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {!filteredTasks.length ? <EmptyState title="暂无历史任务记录" description="可调整筛选条件，或执行一次新的同步任务。" /> : null}
          </div>
        </div>
      ) : null}

      {taskTab === "logs" ? (
        <div className="view-stack">
          <div className="task-log-toolbar">
            <select value={selectedTaskId} onChange={(e) => setSelectedTaskId(e.target.value)}>
              {tasks.map((task) => <option key={task.taskId} value={task.taskId}>{formatDateTime(task.startTime)} · {getTaskModeLabel(task.mode)}</option>)}
            </select>
            <button className="ghost-button" onClick={() => void handleExportTaskLog()} disabled={!selectedTask || busyAction === "export-task-log"}>导出日志</button>
          </div>
          <div className="task-log-toolbar">
            <label className="search-box compact-search">
              <input value={taskLogSearch} onChange={(e) => setTaskLogSearch(e.target.value)} placeholder="搜索日志、仓库名、错误码" />
            </label>
            <select value={taskLogLevelFilter} onChange={(e) => setTaskLogLevelFilter(e.target.value as "all" | "warning" | "error")}>
              <option value="all">全部日志</option>
              <option value="warning">仅警告</option>
              <option value="error">仅错误</option>
            </select>
          </div>
          <div className="summary-row wrap">
            <SummaryPill label="总行数" value={parsedLogLines.length} tone="neutral" />
            <SummaryPill label="当前结果" value={filteredLogLines.length} tone="pending" />
            <SummaryPill label="错误行" value={filteredLogLines.filter((line) => line.level === "error").length} tone="danger" />
          </div>
          <div className="log-line-list" style={{ height: 450 }}>
            {filteredLogLines.length >= 50 ? (
              <AutoSizer>
                {({ height, width }) => (
                  <FixedSizeList
                    height={height}
                    width={width}
                    itemCount={filteredLogLines.length}
                    itemSize={32}
                    overscanCount={10}
                  >
                    {({ index, style }) => {
                      const line = filteredLogLines[index];
                      if (!line) return null;
                      return (
                        <div style={style} className={`log-line ${line.level}`}>
                          <span className="log-line-index">#{line.index}</span>
                          <div className="log-line-badges">
                            <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                            {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                            {line.repoName ? <Badge tone="neutral" text={line.repoName} /> : null}
                          </div>
                          <code className="log-line-text" title={line.text}>{line.text}</code>
                        </div>
                      );
                    }}
                  </FixedSizeList>
                )}
              </AutoSizer>
            ) : (
              filteredLogLines.map((line) => (
                <div key={`${line.index}-${line.text}`} className={`log-line ${line.level}`}>
                  <span className="log-line-index">#{line.index}</span>
                  <div className="log-line-badges">
                    <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
                    {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
                    {line.repoName ? <Badge tone="neutral" text={line.repoName} /> : null}
                  </div>
                  <code className="log-line-text">{line.text}</code>
                </div>
              ))
            )}
            {!filteredLogLines.length ? <EmptyState title="暂无日志记录" description="请选择任务或清空筛选条件后重试。" /> : null}
          </div>
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
  );
}
