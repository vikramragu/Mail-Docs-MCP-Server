#!/usr/bin/env node
import "dotenv/config";
import { loadConfig, type CliOverrides } from "./config.js";
import { setLogLevel, logger, type LogLevel } from "./logger.js";
import { createServer } from "./server.js";
import { runStdioTransport } from "./transports/stdio.js";
import { runHttpTransport } from "./transports/http.js";

function parseArgs(argv: string[]): CliOverrides {
  const overrides: CliOverrides = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--transport") {
      const value = argv[++i];
      if (value === "stdio" || value === "http") overrides.transport = value;
    } else if (arg === "--port") {
      const value = Number(argv[++i]);
      if (!Number.isNaN(value)) overrides.port = value;
    } else if (arg === "--host") {
      overrides.host = argv[++i];
    }
  }
  return overrides;
}

async function main(): Promise<void> {
  const overrides = parseArgs(process.argv.slice(2));
  const config = loadConfig(overrides);
  setLogLevel(config.LOG_LEVEL as LogLevel);

  if (config.MCP_TRANSPORT === "http") {
    await runHttpTransport(config);
  } else {
    const server = createServer(config);
    await runStdioTransport(server);
  }
}

main().catch((err) => {
  logger.error("Fatal error starting server", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
