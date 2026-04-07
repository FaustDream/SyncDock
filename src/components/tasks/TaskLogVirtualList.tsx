import type { CSSProperties } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList } from "react-window";
import { Badge, EmptyState, SummaryPill } from "../index";
import { LOG_PARSE_MAX_LINES, LOG_VIRTUALIZATION_THRESHOLD } from "../../constants";
import type { ParsedLogLine } from "../../utils/logParser";
import { toneFromLogLevel } from "../../utils/taskHelpers";

interface TaskLogVirtualListProps {
  selectedTaskLog: string;
  parsedLogLines: ParsedLogLine[];
  filteredLogLines: ParsedLogLine[];
}

export function TaskLogVirtualList({ selectedTaskLog, parsedLogLines, filteredLogLines }: TaskLogVirtualListProps) {
  const errorCount = filteredLogLines.filter((line) => line.level === "error").length;

  return (
    <div className="view-stack">
      <div className="summary-row wrap">
        <SummaryPill label="总行数" value={parsedLogLines.length} tone="neutral" />
        <SummaryPill label="当前结果" value={filteredLogLines.length} tone="pending" />
        <SummaryPill label="错误行" value={errorCount} tone="danger" />
      </div>
      {selectedTaskLog.trim() ? (
        <p className="helper theme-helper-banner">为避免超长日志导致界面卡死，仅解析最近 {LOG_PARSE_MAX_LINES} 行，并对超长单行进行安全截断。</p>

      ) : null}
      <div className="log-line-list theme-elevated-block" style={{ height: 450 }}>

        {filteredLogLines.length >= LOG_VIRTUALIZATION_THRESHOLD ? (
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <FixedSizeList height={height} width={width} itemCount={filteredLogLines.length} itemSize={60} overscanCount={10}>
                {({ index, style }: { index: number; style: CSSProperties }) => {
                  const line = filteredLogLines[index];
                  if (!line) return null;
                  return (
                    <div style={style} className="pb-2">
                      <TaskLogRow line={line} />
                    </div>
                  );
                }}
              </FixedSizeList>
            )}
          </AutoSizer>
        ) : (
          filteredLogLines.map((line) => <TaskLogRow key={`${line.index}-${line.text}`} line={line} />)
        )}
        {!filteredLogLines.length ? <EmptyState title="暂无日志记录" description="请选择任务或清空筛选条件后重试。" /> : null}
      </div>
    </div>
  );
}

function TaskLogRow({ line }: { line: ParsedLogLine }) {
  return (
    <div className={`log-line ${line.level}`}>
      <span className="log-line-index">#{line.index}</span>
      <div className="log-line-badges">
        <Badge tone={toneFromLogLevel(line.level)} text={line.level} />
        {line.code ? <Badge tone={toneFromLogLevel(line.level)} text={line.code} /> : null}
        {line.repoName ? <Badge tone="neutral" text={line.repoName} /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <code className="log-line-text" title={line.text}>{line.text}</code>
        {line.textTruncated ? <span className="log-line-truncated-hint">该行过长，已截断显示</span> : null}
      </div>
    </div>
  );
}
