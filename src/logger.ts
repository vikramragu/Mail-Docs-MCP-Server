/**
 * Logs to STDERR only. In stdio transport mode, stdout is reserved
 * exclusively for JSON-RPC messages — writing anything else there
 * would corrupt the protocol stream.
 */
const LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentLevel);
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta),
};

/**
 * Audit log: timestamp, tool, recipients count, doc ID, result — never body
 * content. Kept separate from `logger` so its shape stays consistent even
 * if general log verbosity changes.
 */
export function auditLog(event: {
  tool: string;
  result: "success" | "error";
  recipientCount?: number;
  documentId?: string;
  errorMessage?: string;
}): void {
  write("info", "audit", { audit: true, ...event });
}
