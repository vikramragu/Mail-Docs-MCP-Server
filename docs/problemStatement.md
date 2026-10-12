# Problem Statement: Google Workspace MCP Server (Gmail Send + Google Docs Append)

## 1. Summary

Build a **Model Context Protocol (MCP) server** that exposes two capabilities to any MCP-compatible AI agent:

1. **Send email via Gmail** (plain text and HTML, with CC/BCC, reply-to, and optional attachments).
2. **Append content to an existing Google Doc** (plain text, headings, bullet lists, optionally into a specific tab).

The server must be **client-agnostic**. It should work unchanged with Claude (Desktop / Code), ChatGPT (connectors / developer mode), Gemini (Gemini CLI), Cursor, Antigravity, and any other agent that speaks MCP. No vendor-specific logic is allowed in the tool layer.

---

## 2. Goals and Non-Goals

### Goals
- Expose a small, well-described, strongly-typed set of MCP **tools**.
- Support **both transports**:
  - `stdio` for local clients (Cursor, Antigravity, Claude Desktop, Claude Code, Gemini CLI).
  - **Streamable HTTP** for remote clients (ChatGPT connectors, hosted agents).
- Authenticate to Google using **OAuth 2.0** with the minimum required scopes.
- Keep tool input schemas **portable across LLM providers** (see §7).
- Be safe by default: validation, recipient allowlists, dry-run mode, and clear errors.
- Be easy to run: one command to authorize, one command to start.

### Non-Goals (v1)
- Reading or searching the inbox.
- Creating new Google Docs, deleting content, or editing existing text in place.
- Google Sheets, Calendar, Drive file management.
- A UI. This is a headless server.

---

## 3. Users and Use Cases

| Actor | Example prompt to the agent | Tool(s) used |
|---|---|---|
| Developer | "Email the release notes to team@company.com" | `gmail_send_email` |
| PM | "Append today's standup summary to the Weekly Notes doc" | `docs_append_content` |
| Analyst | "Summarize this report, append it to the doc, then email the doc link to my manager" | `docs_get_info`, `docs_append_content`, `gmail_send_email` |
| Anyone | "Draft an email to X but don't send it yet" | `gmail_create_draft` |

---

## 4. Tech Stack

**Primary (recommended):** TypeScript on Node.js 20+
- `@modelcontextprotocol/sdk` (official MCP TypeScript SDK)
- `googleapis` (official Google API client) + `google-auth-library`
- `zod` for input validation (converted to JSON Schema by the SDK)
- `express` (or SDK's built-in HTTP helpers) for Streamable HTTP
- `nodemailer`'s `MailComposer` (or `mimetext`) to build RFC 2822 MIME messages
- `vitest` for tests

**Alternative:** Python 3.11+ with the official `mcp` SDK (FastMCP), `google-api-python-client`, `google-auth-oauthlib`, `pydantic`. The design below applies equally; pick one and stay consistent.

---

## 5. Architecture

```
┌──────────────────────────────┐
│  MCP Client (any agent)      │  Claude / ChatGPT / Gemini / Cursor / Antigravity
└──────────────┬───────────────┘
               │ JSON-RPC over stdio  OR  Streamable HTTP
┌──────────────▼───────────────┐
│  Transport layer             │  src/transports/stdio.ts, http.ts
├──────────────────────────────┤
│  MCP server core             │  src/server.ts  (registers tools, server info)
├──────────────────────────────┤
│  Tools (pure, validated)     │  src/tools/gmail/*.ts, src/tools/docs/*.ts
├──────────────────────────────┤
│  Services                    │  src/services/gmailService.ts, docsService.ts
├──────────────────────────────┤
│  Auth                        │  src/auth/googleAuth.ts, tokenStore.ts
├──────────────────────────────┤
│  Config / Logging / Errors   │  src/config.ts, logger.ts, errors.ts
└──────────────┬───────────────┘
               │ HTTPS
        Gmail API v1 / Google Docs API v1
```

**Rule:** tools never call `googleapis` directly; they call services. Services are mockable for tests. The transport layer knows nothing about Google.

### Suggested project layout
```
google-workspace-mcp/
├── src/
│   ├── index.ts                 # entrypoint: parses CLI flags, picks transport
│   ├── server.ts                # createServer(): registers all tools
│   ├── config.ts                # env + CLI config, validated with zod
│   ├── logger.ts                # logs to STDERR only (stdout is reserved for stdio JSON-RPC)
│   ├── errors.ts                # typed error classes -> MCP tool errors
│   ├── auth/
│   │   ├── googleAuth.ts        # OAuth client, refresh handling
│   │   ├── authorizeCli.ts      # one-time `npm run auth` flow
│   │   └── tokenStore.ts        # file/keychain token storage
│   ├── services/
│   │   ├── gmailService.ts
│   │   └── docsService.ts
│   ├── tools/
│   │   ├── gmail/sendEmail.ts
│   │   ├── gmail/createDraft.ts
│   │   ├── docs/appendContent.ts
│   │   └── docs/getInfo.ts
│   ├── transports/
│   │   ├── stdio.ts
│   │   └── http.ts
│   └── utils/
│       ├── mime.ts              # build RFC 2822 + base64url encode
│       └── docId.ts             # extract doc ID from URL or raw ID
├── tests/
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 6. Tool Specifications

All tools return MCP `content` with a short human-readable `text` block **and** `structuredContent` (JSON) matching a declared `outputSchema`, so both text-only and structured-aware clients work.

All tools set MCP **tool annotations** so clients can show confirmations appropriately:
- Write tools: `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`
- `gmail_send_email`: also mark it clearly in the description as an action with external side effects.
- Read tools: `readOnlyHint: true`

### 6.1 `gmail_send_email`

**Description (shown to the model):**
"Send an email from the authenticated Gmail account. Use only when the user has clearly asked to send. Supports plain text or HTML body, CC, BCC, and reply-to. Returns the Gmail message ID."

**Input schema**
| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | array of string (email) | yes | 1–50 recipients |
| `subject` | string | yes | max 998 chars, no CR/LF |
| `body` | string | yes | message body |
| `body_format` | enum `"text"` \| `"html"` | no | default `"text"` |
| `cc` | array of string (email) | no | |
| `bcc` | array of string (email) | no | |
| `reply_to` | string (email) | no | |
| `attachments` | array of object | no | each: `filename` (string), `mime_type` (string), `content_base64` (string). Total ≤ 20 MB (keep well under Gmail's 25 MB limit after base64 overhead) |
| `thread_id` | string | no | to reply within an existing thread |

**Behavior**
1. Validate all addresses (RFC 5322-lite regex + no header injection: reject `\r` or `\n` in any header field).
2. If `ALLOWED_RECIPIENT_DOMAINS` is configured, reject any recipient outside it.
3. If `DRY_RUN=true`, return the composed message preview without sending.
4. Build MIME message (multipart/alternative when HTML: include a text fallback auto-generated by stripping tags; multipart/mixed when attachments).
5. base64url-encode and call `gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId } })`.

**Output**
```json
{ "status": "sent", "message_id": "18c...", "thread_id": "18c...", "to": ["a@x.com"] }
```

### 6.2 `gmail_create_draft`
Same input as `gmail_send_email`. Calls `gmail.users.drafts.create`. Output: `{ "status": "draft_created", "draft_id": "...", "message_id": "..." }`.
Useful for agents/clients where the user wants to review before sending.

### 6.3 `docs_get_info` (read-only helper)

**Description:** "Get the title, tabs, and current end position of an existing Google Doc. Use before appending if you need to confirm the right document or tab."

**Input**
| Field | Type | Required | Notes |
|---|---|---|---|
| `document` | string | yes | full Google Docs URL **or** raw document ID |

**Behavior:** extract ID with regex `/document/d/([a-zA-Z0-9_-]+)` (fallback: treat input as ID). Call `docs.documents.get({ documentId, includeTabsContent: true })`.

**Output**
```json
{ "document_id": "1AbC...", "title": "Weekly Notes", "url": "https://docs.google.com/document/d/1AbC.../edit",
  "tabs": [{ "tab_id": "t.0", "title": "Tab 1" }] }
```

### 6.4 `docs_append_content`

**Description:** "Append content to the end of an existing Google Doc (optionally a specific tab). Does not modify existing content. Supports paragraphs, headings, and bullet lists."

**Input**
| Field | Type | Required | Notes |
|---|---|---|---|
| `document` | string | yes | URL or ID |
| `blocks` | array of object | yes | 1–200 blocks, each described below |
| `tab_id` | string | no | default: first tab |
| `add_separator` | boolean | no | insert a blank line before the new content; default `true` |

Each block:
| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | enum `"paragraph"` \| `"heading1"` \| `"heading2"` \| `"heading3"` \| `"bullet"` \| `"numbered"` | yes | |
| `text` | string | yes | max 10,000 chars per block |
| `bold` | boolean | no | default false |

> Keep the block model simple and flat on purpose. Do **not** use `oneOf`/`anyOf` unions — several LLM function-calling implementations handle them poorly (see §7).

**Behavior**
1. Resolve document ID; fetch doc (to verify access and get the end index of the target tab's body).
2. Build a single `documents.batchUpdate` request:
   - `insertText` with `endOfSegmentLocation: { tabId }` (or at `endIndex - 1`) for the concatenated text of all blocks, each ending in `\n`.
   - Track character ranges per block, then add `updateParagraphStyle` (`namedStyleType: HEADING_1/2/3` or `NORMAL_TEXT`), `createParagraphBullets` (`BULLET_DISC_CIRCLE_SQUARE` / `NUMBERED_DECIMAL_ALPHA_ROMAN`), and `updateTextStyle` for bold.
   - Note: Docs indexes are UTF-16 code units — compute lengths accordingly (emoji count as 2).
3. Send with `writeControl: { requiredRevisionId }` from the fetch, to avoid writing over concurrent edits; on conflict, re-fetch and retry once.
4. If `DRY_RUN=true`, return the planned requests without calling batchUpdate.

**Output**
```json
{ "status": "appended", "document_id": "1AbC...", "tab_id": "t.0", "blocks_appended": 4, "characters_inserted": 812,
  "url": "https://docs.google.com/document/d/1AbC.../edit" }
```

---

## 7. Cross-Agent Compatibility Requirements

These rules make the same server work with Claude, ChatGPT, Gemini, and others:

1. **Pure MCP, no vendor logic.** Implement only standard MCP: `initialize`, `tools/list`, `tools/call`. Do not branch on client name.
2. **Portable JSON Schema for tool inputs:**
   - Top-level `type: "object"`, explicit `properties`, explicit `required`.
   - `additionalProperties: false` everywhere.
   - Use only `string`, `number`/`integer`, `boolean`, `array`, `object`, `enum`.
   - **Avoid** `oneOf`, `anyOf`, `allOf`, `$ref`, `patternProperties`, recursive schemas, and `format` keywords that some clients reject. Validate formats (email, etc.) server-side with zod instead.
   - Keep nesting ≤ 2 levels.
   - Use `snake_case` tool and field names, tool names ≤ 64 chars, matching `^[a-zA-Z0-9_-]+$`.
3. **Descriptions are the API for the model.** Every tool and field gets a clear description, including when *not* to use the tool.
4. **Both transports** from one codebase:
   - `stdio` (default): `node dist/index.js`
   - Streamable HTTP: `node dist/index.js --transport http --port 8080` exposing `POST/GET /mcp`.
   - Support stateless mode for HTTP so it can run behind load balancers / serverless.
5. **Return both** `content: [{ type: "text", ... }]` and `structuredContent` so text-only clients still get useful output.
6. **Errors as tool results**, not protocol crashes: return `isError: true` with an actionable message (e.g. "Document not found or not shared with the authorized account").
7. **Never write to stdout** in stdio mode except JSON-RPC. All logs go to stderr.

---

## 8. Authentication & Authorization

### 8.1 Google side (server → Google)

**Scopes (minimum):**
- `https://www.googleapis.com/auth/gmail.send` (send only; no inbox read)
- `https://www.googleapis.com/auth/gmail.compose` (only if `gmail_create_draft` is enabled)
- `https://www.googleapis.com/auth/documents` (needed to edit *existing* docs; `drive.file` alone only covers files the app created or the user opened via a picker)

Scopes must be configurable so a deployment can disable features it doesn't need.

**Mode A — Local, single user (default for stdio):**
- Google Cloud project → enable Gmail API + Google Docs API → OAuth consent screen → OAuth client of type **Desktop app**.
- `npm run auth` opens the browser (loopback redirect on `127.0.0.1:<random port>`), user consents, refresh token saved to `~/.config/google-workspace-mcp/token.json` with file mode `0600` (or the OS keychain if available).
- Server auto-refreshes access tokens; on `invalid_grant`, return a tool error telling the user to re-run `npm run auth`.
- Note in README: while the OAuth app is in "Testing" status, refresh tokens expire after 7 days and only listed test users can authorize.

**Mode B — Service account (Workspace only, optional):**
- Domain-wide delegation with `GOOGLE_IMPERSONATE_USER`. Documented as an option for organizations.

**Mode C — Remote, multi-user (HTTP, optional v2):**
- Each MCP user maps to their own Google tokens. Follow the MCP Authorization spec (OAuth 2.1, protected resource metadata) so clients like ChatGPT can run the sign-in flow. Out of scope for v1 except for the interface design.

### 8.2 Client side (agent → server, HTTP only)
- v1: static bearer token via `MCP_AUTH_TOKEN`; reject requests without `Authorization: Bearer <token>`.
- Bind to `127.0.0.1` by default; require explicit `--host 0.0.0.0` to expose.
- Validate `Origin` header on HTTP requests (DNS-rebinding protection).
- HTTPS required for any non-localhost deployment (terminate TLS at a reverse proxy or tunnel).

---

## 9. Configuration

`.env.example`
```
# Google OAuth (Desktop client)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_TOKEN_PATH=~/.config/google-workspace-mcp/token.json

# Features
ENABLE_GMAIL_SEND=true
ENABLE_GMAIL_DRAFTS=true
ENABLE_DOCS_APPEND=true

# Safety
DRY_RUN=false
ALLOWED_RECIPIENT_DOMAINS=          # e.g. "company.com,partner.com" (empty = any)
MAX_RECIPIENTS=50
MAX_ATTACHMENT_MB=20
ALLOWED_DOCUMENT_IDS=               # optional allowlist of doc IDs

# HTTP transport
MCP_TRANSPORT=stdio                 # stdio | http
MCP_HTTP_PORT=8080
MCP_HTTP_HOST=127.0.0.1
MCP_AUTH_TOKEN=

LOG_LEVEL=info
```

Disabled features must not appear in `tools/list`.

---

## 10. Error Handling

| Condition | Source | Tool result message (isError: true) |
|---|---|---|
| Invalid email / header injection | validation | "Invalid recipient: …" |
| Recipient outside allowlist | policy | "Recipient domain not allowed: …" |
| Token missing/expired/revoked | auth | "Google authorization required. Run `npm run auth`." |
| 403 insufficient scope | Google | "Missing permission scope: … Re-authorize." |
| 404 document | Docs API | "Document not found or not shared with this account." |
| 403 on document | Docs API | "No edit access to this document." |
| 429 / 5xx | Google | Retry with exponential backoff + jitter (max 3 tries), then "Google API temporarily unavailable." |
| Attachment too large | validation | "Attachments exceed N MB." |

Never leak tokens, raw stack traces, or full email bodies in errors or logs.

---

## 11. Security & Privacy Requirements
- Least-privilege scopes; no inbox read scopes.
- Tokens stored outside the repo, `0600` permissions; `.gitignore` covers `token.json`, `.env`, `credentials*.json`.
- Header-injection protection on all email headers.
- Optional recipient-domain and document-ID allowlists.
- `DRY_RUN` mode for testing agents safely.
- Audit log (stderr / file): timestamp, tool, recipients count, doc ID, result — **no** body content.
- Treat all tool inputs as untrusted (they may come from prompt-injected content). The tool descriptions should tell the model to send only on explicit user intent; clients' confirmation UIs are the second line of defense.

---

## 12. Client Setup (to document in README)

**Cursor** — `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):
```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/google-workspace-mcp/dist/index.js"],
      "env": { "GOOGLE_CLIENT_ID": "...", "GOOGLE_CLIENT_SECRET": "..." }
    }
  }
}
```

**Antigravity** — add the same `mcpServers` entry via its MCP server settings (raw `mcp_config.json`).

**Claude Desktop** — `claude_desktop_config.json`, same `mcpServers` shape.
**Claude Code** — `claude mcp add google-workspace -- node /abs/path/dist/index.js`.

**Gemini CLI** — `~/.gemini/settings.json`, same `mcpServers` shape (`command`, `args`, `env`).

**ChatGPT** — requires a **remote HTTPS** server: run with `--transport http`, expose via a reverse proxy or a tunnel (e.g. ngrok / Cloudflare Tunnel) during development, then add it as a custom connector (developer mode is needed for write actions). URL: `https://<host>/mcp`.

**Any other agent / framework** (OpenAI Agents SDK, LangChain MCP adapters, Google ADK, etc.) — connect via stdio or Streamable HTTP using the framework's MCP client.

> Exact menu paths and file locations in these clients change often; verify against each client's current docs when writing the README.

---

## 13. Testing Requirements
- **Unit tests:** MIME builder (text, HTML, attachments, UTF-8 subjects encoded per RFC 2047), doc-ID extraction, UTF-16 index math, batchUpdate request builder, validation and allowlists.
- **Service tests:** mock `googleapis`; verify correct request payloads and error mapping.
- **Protocol tests:** start server in-process, call `tools/list` and `tools/call` via the SDK client over both transports; assert schemas contain none of the disallowed keywords from §7.
- **Manual:** MCP Inspector (`npx @modelcontextprotocol/inspector node dist/index.js`).
- **E2E (opt-in, real account):** send to a self address; append to a dedicated test doc.
- **Cross-client smoke test:** verify tool discovery and one successful call in Cursor, Claude, Gemini CLI, and ChatGPT.

---

## 14. Acceptance Criteria
1. `npm run auth` completes OAuth and stores a refresh token; server starts without prompting afterwards.
2. `tools/list` returns exactly the enabled tools with valid, portable JSON Schemas.
3. `gmail_send_email` delivers a text email, an HTML email (with text fallback), and an email with a PDF attachment; returns message ID.
4. `gmail_create_draft` creates a draft visible in Gmail.
5. `docs_append_content` appends paragraphs, headings, bullets, and numbered items to the end of an existing doc without altering prior content, including into a non-default tab.
6. Accepts both doc URL and raw ID.
7. All error cases in §10 return `isError: true` with the listed message style; no crashes.
8. `DRY_RUN=true` performs no external writes.
9. Works over stdio in Cursor/Antigravity and Claude, and over Streamable HTTP with a bearer token.
10. No stdout pollution in stdio mode; no secrets in logs.
11. Test coverage ≥ 80% on services, tools, and utils.

---

## 15. Milestones
1. **Scaffold** — project, config, logger, stdio transport, a `ping` tool; verify in MCP Inspector.
2. **Auth** — OAuth desktop flow, token store, refresh handling.
3. **Gmail** — MIME builder, `gmail_send_email`, `gmail_create_draft`, tests.
4. **Docs** — `docs_get_info`, `docs_append_content` with styling and tabs, tests.
5. **Safety** — allowlists, dry-run, audit log, error mapping.
6. **HTTP transport** — Streamable HTTP, bearer auth, Origin check, stateless mode.
7. **Cross-client verification + README** with setup for every client in §12.

---

## 16. Future Extensions (not v1)
- `docs_create_document`, `docs_replace_text`, `docs_insert_table`
- `gmail_search` / `gmail_read` (read scopes, opt-in)
- Google Sheets append, Calendar events
- Full MCP OAuth 2.1 for multi-user remote hosting
- Packaging: `npx google-workspace-mcp`, Docker image
