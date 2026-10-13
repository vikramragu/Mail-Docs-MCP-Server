# google-workspace-mcp

A client-agnostic **Model Context Protocol (MCP) server** that exposes two Google Workspace capabilities to any MCP-compatible agent:

- **Gmail**: send an email, or create a draft (`gmail_send_email`, `gmail_create_draft`)
- **Google Docs**: inspect a doc, and append paragraphs/headings/bullets to it (`docs_get_info`, `docs_append_content`)

It speaks plain MCP over both **stdio** (Cursor, Claude Desktop/Code, Gemini CLI, Antigravity) and **Streamable HTTP** (ChatGPT connectors, hosted agents) — no vendor-specific logic anywhere in the tool layer.

See [docs/problemStatement.md](docs/problemStatement.md) for the full design spec this implementation follows.

## Features

- OAuth 2.0 (Desktop app flow) with least-privilege, per-feature scopes
- Recipient-domain and document-ID allowlists, attachment size limits, `DRY_RUN` mode
- Header-injection-safe MIME composition (RFC 2822 + RFC 2047 subjects), HTML → text fallback
- Optimistic-concurrency Docs edits (`writeControl`) with one retry on conflict
- Portable JSON Schemas (no `oneOf`/`anyOf`/`$ref`/`format`) so the same server works unmodified across MCP clients
- stdout reserved exclusively for JSON-RPC in stdio mode; all logs go to stderr
- 96 automated tests (unit, mocked-service, and in-process protocol tests), 100% statement coverage on services/tools/utils

## Quick start

```bash
npm install
cp .env.example .env   # fill in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
npm run build
npm run auth           # one-time OAuth consent flow
npm start               # stdio transport by default
```

### 1. Create a Google Cloud OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or select) a project.
2. Enable the **Gmail API** and **Google Docs API**.
3. Configure the OAuth consent screen (External or Internal). While the app is in **Testing** status, refresh tokens expire after 7 days and only listed test users can authorize — add yourself as a test user.
4. Create an OAuth client of type **Desktop app**. Copy the Client ID and Client Secret into `.env`.

### 2. Authorize once

```bash
npm run auth
```

This opens a browser for the Google consent screen (via a local loopback redirect), then saves a refresh token to `GOOGLE_TOKEN_PATH` (default `~/.config/google-workspace-mcp/token.json`, created with `0600` permissions). The server reads this file and auto-refreshes access tokens; it never prompts again unless the token is revoked (`invalid_grant`), in which case tool calls return an error telling you to re-run `npm run auth`.

### 3. Run the server

```bash
npm start                                   # stdio (default)
node dist/index.js --transport http --port 8080 --host 127.0.0.1
```

CLI flags (`--transport`, `--port`, `--host`) override the corresponding `.env` values.

## Configuration

All configuration is via environment variables (see [.env.example](.env.example)):

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — (required) | OAuth Desktop client credentials |
| `GOOGLE_TOKEN_PATH` | `~/.config/google-workspace-mcp/token.json` | Where the refresh token is stored |
| `GOOGLE_TOKEN_JSON_B64` | — | Base64 of a `token.json` from `npm run auth`. Only needed on ephemeral hosts (e.g. Railway) — written to `GOOGLE_TOKEN_PATH` once at startup if that file doesn't already exist; see [docs/deployment-plan.md](docs/deployment-plan.md) §0.2 |
| `ENABLE_GMAIL_SEND` / `ENABLE_GMAIL_DRAFTS` / `ENABLE_DOCS_APPEND` | `true` | Toggle each tool; disabled tools are omitted from `tools/list` entirely and their OAuth scope is not requested |
| `DRY_RUN` | `false` | When `true`, tools validate and compose the request but perform no external write — Gmail tools return a decoded MIME preview, Docs tools return the planned `batchUpdate` requests |
| `ALLOWED_RECIPIENT_DOMAINS` | empty (any) | Comma-separated allowlist; recipients outside it are rejected |
| `MAX_RECIPIENTS` | `50` | Combined cap across `to`/`cc`/`bcc` |
| `MAX_ATTACHMENT_MB` | `20` | Combined attachment size cap |
| `ALLOWED_DOCUMENT_IDS` | empty (any) | Comma-separated allowlist of Google Doc IDs |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address; use `--host 0.0.0.0` to expose beyond localhost |
| `MCP_HTTP_PORT` | `8080` | HTTP port |
| `MCP_AUTH_TOKEN` | — | **Required** when `MCP_TRANSPORT=http`; clients must send `Authorization: Bearer <token>` |
| `MCP_ALLOWED_ORIGINS` | empty | Comma-separated exact public origin(s), e.g. `https://your-app.up.railway.app`. **Required once `MCP_HTTP_HOST` isn't localhost** — otherwise every request carrying an `Origin` header is rejected (403) |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error`, all written to stderr |

The HTTP transport also exposes an unauthenticated `GET /healthz` (returns `200`) for platform health checks.

## Tools

| Tool | Read-only? | Description |
|---|---|---|
| `gmail_send_email` | No | Sends an email immediately (external side effect) — only when the user has clearly asked to send |
| `gmail_create_draft` | No | Creates a Gmail draft without sending |
| `docs_get_info` | Yes | Returns a doc's title, tabs, and URL |
| `docs_append_content` | No | Appends paragraphs/headings/bullets/numbered items to the end of an existing doc or tab |

Each tool returns both a short `content` text block and a JSON `structuredContent` payload, and reports failures as `isError: true` tool results (never a protocol crash) — see `docs/problemStatement.md` §10 for the full error-to-message mapping.

## Client setup

### Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": { "GOOGLE_CLIENT_ID": "...", "GOOGLE_CLIENT_SECRET": "..." }
    }
  }
}
```

### Antigravity

Add the same `mcpServers` entry via its MCP server settings (raw `mcp_config.json`).

### Claude Desktop

Add the same `mcpServers` shape to `claude_desktop_config.json`.

### Claude Code

```bash
claude mcp add google-workspace -- node /absolute/path/to/google-workspace-mcp/dist/index.js
```

### Gemini CLI

Add the same `mcpServers` shape (`command`, `args`, `env`) to `~/.gemini/settings.json`.

### ChatGPT

Requires a **remote HTTPS** server. Run with `--transport http`, expose it via a reverse proxy or tunnel (e.g. ngrok, Cloudflare Tunnel) during development, then add it as a custom connector (developer mode needed for write actions) at `https://<host>/mcp`, with the bearer token from `MCP_AUTH_TOKEN`.

### Any other MCP framework

Connect via stdio or Streamable HTTP using that framework's MCP client — nothing here is vendor-specific.

> Exact menu paths in each client's UI change often; verify against that client's current docs.

## Testing

```bash
npm test              # unit + service + protocol tests (vitest)
npm run test:coverage # with coverage report
npm run typecheck
```

- **Unit tests** (`tests/unit/`): MIME builder, doc-ID extraction, UTF-16 index math, the Docs `batchUpdate` request builder, validation/allowlist logic, Google-error classification + retry.
- **Service tests** (`tests/service/`): `googleapis` is mocked; these assert the exact request payloads sent to Gmail/Docs and verify error mapping, including the Docs revision-conflict retry path and the end-to-end tool call flow (via an in-memory MCP client/server pair) with Google auth also mocked.
- **Protocol tests** (`tests/protocol/`): start the server in-process (and, for HTTP, on a real loopback socket) and call `tools/list`/`tools/call` through the official SDK client, asserting schemas contain none of the keywords disallowed by `problemStatement.md` §7, and exercising the HTTP transport's bearer-auth and Origin-header checks.

### Manual verification (not run by this repo's automation)

These require a real Google Cloud OAuth client and, for cross-client checks, the actual client applications — run them yourself after `npm run auth`:

- **MCP Inspector**: `npm run inspector` (`npx @modelcontextprotocol/inspector node dist/index.js`)
- **E2E**: with `DRY_RUN=false`, send an email to yourself and append content to a scratch Google Doc you own
- **Cross-client smoke test**: confirm tool discovery and one successful call in each of Cursor, Claude, Gemini CLI, and ChatGPT (§13 of the problem statement)

## Project layout

```
src/
├── index.ts                 # entrypoint: CLI flags, picks transport
├── server.ts                 # createServer(): registers all tools
├── config.ts                 # env + CLI config, validated with zod
├── logger.ts                  # stderr-only logger + audit log
├── errors.ts                  # typed errors -> MCP tool-result mapping, retry/backoff
├── auth/                      # OAuth client, token storage, `npm run auth` flow
├── services/                  # gmailService.ts, docsService.ts — the only code that calls googleapis
├── tools/                     # gmail/{sendEmail,createDraft}.ts, docs/{getInfo,appendContent}.ts
├── transports/                # stdio.ts, http.ts
└── utils/                     # mime.ts, docId.ts, docsIndex.ts, docsRequestBuilder.ts
tests/
├── unit/                       # pure functions, no I/O
├── service/                    # mocked googleapis + auth
└── protocol/                   # in-process / real-socket MCP protocol tests
```

Tools never call `googleapis` directly — they call `services/`, which are the only mockable I/O boundary. The transport layer knows nothing about Google.

## Security notes

- Least-privilege scopes only (`gmail.send`, `gmail.compose`, `documents`) — no inbox read scope is ever requested.
- Tokens are stored outside the repo with `0600` permissions; `.env`, `token.json`, and `credentials*.json` are gitignored.
- All email headers are checked for CR/LF injection before composing the MIME message.
- The audit log (stderr) records timestamp, tool, recipient count, and document ID — never message bodies.
- Tool inputs are treated as untrusted (they may originate from prompt-injected content); tool descriptions tell the model to act only on explicit user intent, and the calling client's own confirmation UI is the second line of defense.

## Non-goals (v1)

Per `docs/problemStatement.md` §2 and §16: inbox read/search, creating or in-place-editing Google Docs, Sheets/Calendar/Drive file management, a UI, and full multi-user MCP OAuth 2.1 (the HTTP transport here uses a single static bearer token, Mode C in the spec).
