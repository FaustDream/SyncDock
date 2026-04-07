export type ParsedLogLine = {
  index: number;
  text: string;
  level: "info" | "warning" | "error";
  repoName?: string | null;
  code?: string | null;
  textTruncated?: boolean;
};

export type ParseTaskLogOptions = {
  maxLines?: number;
  maxLineLength?: number;
};

function getTailLines(log: string, maxLines: number): { text: string; skippedLines: number } {
  if (maxLines <= 0) {
    return { text: "", skippedLines: 0 };
  }

  let newlineCount = 0;
  let startIndex = 0;

  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i] === "\n") {
      newlineCount += 1;
      if (newlineCount >= maxLines) {
        startIndex = i + 1;
        break;
      }
    }
  }

  if (startIndex === 0 && newlineCount < maxLines) {
    return { text: log, skippedLines: 0 };
  }

  return {
    text: log.slice(startIndex),
    skippedLines: newlineCount >= maxLines ? newlineCount : 0
  };
}

function truncateLogLine(text: string, maxLineLength: number): { text: string; truncated: boolean } {
  if (maxLineLength <= 0 || text.length <= maxLineLength) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, maxLineLength)} …[已截断]`,
    truncated: true
  };
}

/**
 * 解析任务日志
 */
export function parseTaskLog(log: string, options: ParseTaskLogOptions = {}): ParsedLogLine[] {
  if (!log.trim()) {
    return [];
  }

  const maxLines = options.maxLines ?? Number.POSITIVE_INFINITY;
  const maxLineLength = options.maxLineLength ?? Number.POSITIVE_INFINITY;
  const tail = Number.isFinite(maxLines) ? getTailLines(log, maxLines) : { text: log, skippedLines: 0 };

  return tail.text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const repoMatch = line.match(/\[[^\]]+\]\[([^\]]+)\]/);
      const codeMatch = line.match(/SD-[A-Z]+-\d+/);
      const truncatedLine = truncateLogLine(line, maxLineLength);
      return {
        index: tail.skippedLines + index + 1,
        text: truncatedLine.text,
        level: inferLogLevel(line),
        repoName: repoMatch?.[1] ?? null,
        code: codeMatch?.[0] ?? null,
        textTruncated: truncatedLine.truncated
      };
    });
}

/**
 * 推断日志级别
 */
export function inferLogLevel(line: string): ParsedLogLine["level"] {
  const text = line.toLowerCase();
  if (text.includes("fatal") || text.includes("error") || text.includes("failed") || text.includes("失败")) {
    return "error";
  }
  if (text.includes("warning") || text.includes("warn") || text.includes("跳过") || text.includes("skipped")) {
    return "warning";
  }
  return "info";
}

