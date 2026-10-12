import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpToolError } from "../errors.js";
import { auditLog } from "../logger.js";

export function textResult(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export interface AuditMeta {
  recipientCount?: number;
  documentId?: string;
}

/**
 * Runs a tool handler, converting thrown errors into `isError: true` tool
 * results (never protocol-level crashes) and recording an audit log entry
 * — timestamp/tool/recipient-count/doc-id/result only, never body content.
 */
export async function runTool(toolName: string, meta: AuditMeta, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    const result = await fn();
    auditLog({ tool: toolName, result: "success", ...meta });
    return result;
  } catch (err) {
    const message = err instanceof McpToolError ? err.message : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
    auditLog({ tool: toolName, result: "error", errorMessage: message, ...meta });
    return errorResult(message);
  }
}
