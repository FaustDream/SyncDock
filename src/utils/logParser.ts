export type ParsedLogLine = {
  index: number;
  text: string;
  level: "info" | "warning" | "error";
  repoName?: string | null;
  code?: string | null;
};

/**
 * 解析任务日志
 */
export function parseTaskLog(log: string): ParsedLogLine[] {
  if (!log.trim()) {
    return [];
  }

  return log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const repoMatch = line.match(/\[[^\]]+\]\[([^\]]+)\]/);
      const codeMatch = line.match(/SD-[A-Z]+-\d+/);
      return {
        index: index + 1,
        text: line,
        level: inferLogLevel(line),
        repoName: repoMatch?.[1] ?? null,
        code: codeMatch?.[0] ?? null
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
