# Project Context

A running log of what this project is, what's been built, what's been verified, and what's pending — written as a handoff/reference point before starting frontend work. For the original spec, see [problemStatement.md](problemStatement.md); for Railway deployment details, see [deployment-plan.md](deployment-plan.md).

## What this is

`google-workspace-mcp` — an MCP (Model Context Protocol) server exposing two Google Workspace capabilities to any MCP-compatible AI agent:
- **Gmail**: send an email, or create a draft
- **Google Docs**: read a doc's info (title/tabs/URL), and append paragraphs/headings/bullets/numbered lists to an existing doc

It's client-agnostic (no vendor-specific logic) and runs over both `stdio` (local clients: Cursor, Claude Desktop/Code, Gemini CLI) and Streamable HTTP (remote clients: ChatGPT connectors, hosted agents).

## Repos / identifiers (these intentionally don't all match — see below)

- **Local path**: `/Users/betteropinions/Development/AI/mcp-server`
- **GitHub repo**: `https://github.com/vikramragu/Mail-Docs-MCP-Server`, branch `main` (the only branch — `master` was renamed/merged into `main` to match GitHub's actual default branch)
- **npm package name / MCP `serverInfo.name`**: `google-workspace-mcp` (set in `package.json` and `src/server.ts`'s `McpServer` constructor — this is the name an MCP client sees when it connects, unrelated to the GitHub repo name)
- **Live deployment**: `https://mail-docs-mcp-server-production.up.railway.app/mcp` (Railway project "robust-wisdom", environment "production")

## Architecture (brief — see README.md for the full layout)

- `src/server.ts` — `createServer(config)`, the one place all 5 tools register onto a single `McpServer` instance
- `src/tools/gmail/*.ts`, `src/tools/docs/*.ts` — one `register*Tool()` function per tool; tools never call `googleapis` directly
- `src/services/gmailService.ts`, `src/services/docsService.ts` — the only code that calls the Gmail/Docs APIs
- `src/auth/` — OAuth (Desktop app flow), token storage, and (added for deployment) env-var token bootstrap
- `src/transports/stdio.ts`, `src/transports/http.ts` — transport layer, knows nothing about Google
- No custom classes anywhere in app code — functional style throughout. The only class is the SDK's own `McpServer`.

### The 5 tools exposed

| Tool | Read-only? | Registered in |
|---|---|---|
| `ping` | yes | inline in `createServer()`, `src/server.ts` |
| `gmail_send_email` | no (real side effect) | `src/tools/gmail/sendEmail.ts` |
| `gmail_create_draft` | no | `src/tools/gmail/createDraft.ts` |
| `docs_get_info` | yes | `src/tools/docs/getInfo.ts` |
| `docs_append_content` | no | `src/tools/docs/appendContent.ts` |

How a client discovers/calls them: MCP is JSON-RPC over one single endpoint (`POST /mcp`, or stdin/stdout for stdio) — there is no per-tool URL. The SDK's `McpServer` keeps an internal `_registeredTools` object (tool name → schema/handler), populated by each `registerTool()` call. `tools/list` serializes that object for discovery; `tools/call` looks up `params.name` in it and invokes the handler.

**Important, by design (non-goal, not a bug)**: `document` is a *required* argument on both Docs tools — there is no server-side "default doc," no auto-create. Omitting it is rejected immediately by MCP input validation (`isError: true`, "Required at document") before any of our code runs. Whatever calls this server must already know which doc it means.

## Key decisions / bugs found and fixed along the way

1. **Schema portability bugs** (caught before deploying, not obvious from the spec): the MCP SDK normalizes an *empty* zod raw-shape through `zod/v4-mini` internally, which silently drops `additionalProperties: false` — fixed by giving `ping` a real `z.object({})` instead of `{}`. Also, reusing one `zod` schema instance across multiple fields (e.g. one `emailSchema` for `to`/`cc`/`bcc`/`reply_to`) makes `zod-to-json-schema` emit a `$ref`, which `problemStatement.md` §7 explicitly disallows — fixed with a factory function (`emailField()`) returning a fresh instance per field.
2. **Error-message bug**: `classifyGoogleError` originally mapped a generic 403 to a Docs-specific "No edit access to this document" message regardless of which API it came from — a Gmail 403 would show the wrong message. Fixed with a `context: "generic" | "documents"` parameter.
3. **OAuth `redirect_uri_mismatch`** (the real blocker during initial authorization, not a Google Cloud Console config issue as first suspected): `src/auth/authorizeCli.ts` was calling `server.address()` *after* `server.close()`, which returns `null` once a server is closed — silently sending `redirect_uri=...:0` to Google's token endpoint instead of the real port used to generate the auth URL. Fixed by capturing the redirect URI once and reusing it.
4. **`.env` was never actually loaded** — nothing called `dotenv.config()`. Fixed by adding `dotenv` and `import "dotenv/config"` in `src/index.ts` and `src/auth/authorizeCli.ts` only (not in `config.ts`, to keep test isolation intact).
5. **Origin-check bug, found while planning the Railway deployment** (`src/transports/http.ts`): `isOriginAllowed` compared the request's `Origin` header against `MCP_HTTP_HOST` — the bind address, not the public hostname. Once bound to `0.0.0.0` (required on Railway), no real client's `Origin` would ever match, 403-ing every browser-based client. Fixed with a new `MCP_ALLOWED_ORIGINS` allowlist config value (currently **not set** on the live deployment — deferred, see Pending below).
6. **OAuth token survives redeploys**: Railway containers are ephemeral, so the token file from `npm run auth` would be lost on every redeploy. Added `GOOGLE_TOKEN_JSON_B64` (base64 of a locally-generated `token.json`) + `src/auth/bootstrapToken.ts`'s `bootstrapTokenFromEnv()`, called once at startup — decodes and writes the token file only if one doesn't already exist, never overwrites.
7. **`GET /healthz`** added, unauthenticated, for Railway's health checks (since `GET /mcp` intentionally returns 405 in stateless mode).

## Testing

115 tests (unit + mocked-service + in-process/real-socket protocol tests), 100% statement/line/function coverage on `services/tools/utils`, 86.9% branch. `npm test` / `npm run test:coverage` / `npm run typecheck`.

## Deployment state (as of last verification)

Railway env vars currently set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_PATH`, `GOOGLE_TOKEN_JSON_B64`, `ENABLE_GMAIL_SEND`/`ENABLE_GMAIL_DRAFTS`/`ENABLE_DOCS_APPEND` (all `true`), `DRY_RUN=false` (**live — real actions fire for real**), `LOG_LEVEL=info`, `MCP_AUTH_TOKEN`.

Start Command: `sh -c "MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=$PORT node dist/index.js"`

**`MCP_AUTH_TOKEN` note**: the original token generated during setup was posted in chat multiple times and should be treated as compromised. A replacement was generated (`c448b139...`) — confirm whether it was actually applied to the Railway variable before trusting that the live token matches what's in any client config. Rotate again if unsure.

### Verified working end-to-end against the live deployment (not just local tests)
- `GET /healthz` → 200
- Bearer auth: no/wrong token → 401
- `initialize` / `tools/list` → all 5 tools returned
- **Real email sent and received** (Gmail message ID `1a136a41af5e7757`, to `wikram94@gmail.com`)
- **Real Docs append verified** (doc `1EOGbgxpG-8CO689zty-kxiiTmDBi6RcOSlibWy0UHUs`, 2 blocks / 101 chars appended)

## Pending / open items (not blockers, just not done yet)

- `MCP_ALLOWED_ORIGINS` — deferred by choice. Only matters for browser-based clients (e.g. a ChatGPT connector) that send an `Origin` header; CLI/agent clients (Claude Desktop, etc.) are unaffected either way.
- `ALLOWED_RECIPIENT_DOMAINS` / `ALLOWED_DOCUMENT_IDS` — unset. On a public-facing deployment, the bearer token is currently the *only* thing preventing "send email to anyone" / "edit any doc the authorized account can see." Worth deciding on before wider use.
- No real MCP client is connected yet (ChatGPT, Claude Desktop, Cursor, etc.) — the server works, but nothing uses it day-to-day yet.
- Confirm the rotated `MCP_AUTH_TOKEN` was actually applied on Railway (see note above).

## Next phase

Building a frontend for this project. No further spec captured yet beyond that stated intent.
