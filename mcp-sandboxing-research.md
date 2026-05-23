# MCP sandboxing & approvals — research notes for `@forinda/kickjs-mcp`

> Captured 2026-05-23. Complements `mcp-sandboxing-reply.md`. Verified against `@forinda/kickjs-mcp@5.2.2` and MCP spec revision 2025-06-18.

Client-side approvals (Claude Desktop / Cursor / Zed modal prompts) are well-established. The interesting question for kickjs is what the **server** should add on top, since in-process Express dispatch gives us a privileged execution context the client UI cannot constrain.

## 1. MCP spec primitives that bear on this

Spec revision **2025-06-18** ([modelcontextprotocol.io](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)).

- **Tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) — shipped in revision **2025-03-26** on the `ToolAnnotations` object. Spec is explicit that these are **hints, not enforceable guarantees** ([MCP blog](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)). Defaults pessimistic: `destructiveHint: true`, `openWorldHint: true` — read-only and closed-domain tools must opt in. Mapping to kickjs: trivial — extend `@McpTool({ readOnly, destructive, idempotent, openWorld })`. Claude Desktop already colours approval prompts based on these.
- **Elicitation** (`elicitation/create`) — added in 2025-06-18. Server sends a JSON-Schema-typed prompt mid-tool-call; client renders it; user replies ([spec](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation), [VS Code](https://den.dev/blog/vscode-mcp-elicitations-stop-guessing/), [GitHub blog](https://github.blog/ai-and-ml/github-copilot/building-smarter-interactions-with-mcp-elicitation-from-clunky-tool-calls-to-seamless-user-experiences/)). Spec forbids requesting "sensitive information" (passwords, tokens). VS Code, Memgraph, and several Python servers implement it today. Single most-leveraged primitive for kickjs.
- **Sampling** (`sampling/createMessage`) — server asks the client's LLM for a completion ([spec](https://modelcontextprotocol.io/specification/draft/client/sampling)). Useful for "explain to the user what this call will do" approval copy.
- **Roots** — filesystem URI scopes the client suggests; spec says servers are **not bound** to honour them ([WorkOS](https://workos.com/blog/mcp-roots-guide), [Speakeasy](https://www.speakeasy.com/mcp/core-concepts/roots)). Enforcement is on our side.
- **Transport auth** — MCP requires **OAuth 2.0 Protected Resource Metadata (RFC 9728)** discovery on HTTP transports, with OAuth 2.1 + PKCE on the AS side ([spec](https://modelcontextprotocol.io/specification/draft/basic/authorization), [Descope](https://www.descope.com/blog/post/mcp-auth-spec), [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)). The unwired `McpAuthOptions.validate` hook in 5.2.2 is the natural place to land this.

## 2. How other MCP server frameworks handle sandboxing today

- **Official Anthropic reference servers** (`modelcontextprotocol/servers`) — no in-process sandbox. The filesystem server relied on path-string checks, which is precisely how it was broken. **CVE-2025-53109 / CVE-2025-53110 ("EscapeRoute")** were symlink-based escapes in versions <0.6.3 / <2025.7.1, CVSS 8.4 ([Cymulate](https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/), [Embrace The Red](https://embracethered.com/blog/posts/2025/anthropic-filesystem-mcp-server-bypass/)). String-validating paths in-process is a dead end.
- **Anthropic Sandbox Runtime (`@anthropic-ai/sandbox-runtime`, "srt")** — separate open-source project at [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime). OS-level only: `sandbox-exec` + Seatbelt on macOS, `bubblewrap` + network-namespace on Linux, plus a network-filtering proxy. Designed to wrap "agents, local MCP servers, bash commands and arbitrary processes". Anthropic's own answer to EscapeRoute is to externalise sandboxing to the OS.
- **Cloudflare Workers MCP / "Code Mode" / Dynamic Workers** — V8 isolates as the sandbox. No filesystem, no env-var leakage, outbound HTTP routed through a Cap'n Web RPC bridge that injects credentials so guest code never sees them ([Code Mode](https://blog.cloudflare.com/code-mode/), [Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)). Threat model: untrusted agent-generated code.
- **FastMCP (Python)** — ships "sandboxed filesystem" + SSRF guards + Origin validation + bearer auth + Pydantic validation ([MCPMarket](https://mcpmarket.com/server/fastmcp-12)). The "sandboxed filesystem" is application-level path-scoping (MCP Roots), not OS sandboxing — same class of design EscapeRoute defeated. They recommend Docker on top.
- **Mastra (TypeScript)** — no sandboxing on the server side. Tools are typed workflows executed in-process via `workflow.createRun()` ([reference](https://mastra.ai/reference/tools/mcp-server)). Same shape as kickjs today.
- **mcp-deno-sandbox** — explicitly an MCP server whose single tool is "run code under Deno's permission flags" ([repo](https://github.com/bewt85/mcp-deno-sandbox)). The sandbox is the product.
- **MCP gateways** (Kong, [Microsoft mcp-gateway](https://github.com/microsoft/mcp-gateway), [Kuadrant mcp-gateway](https://github.com/Kuadrant/mcp-gateway), Red Hat OpenShift MCP gateway, Preloop) — push sandboxing/approval **out of the server** into a reverse proxy with identity-based tool filtering, mandatory approvals, audit logs, Envoy/Istio rate limiting. Threat model: untrusted MCP servers in front of trusted enterprise data.

**Summary:** no mainstream in-process MCP server framework ships sandboxing. The pattern is either (a) push it to the OS via srt-style wrappers, (b) push it to a V8 isolate (Cloudflare-only), or (c) push it to a gateway. Kickjs on Express is firmly in the "no sandbox" camp — same as Mastra and FastMCP.

## 3. General sandboxing techniques applicable to a Node MCP server

- **Node `--experimental-permission`** ([nodejs.org/api/permissions](https://nodejs.org/api/permissions.html), [2026 changes](https://dev.to/1xapi/5-nodejs-permission-model-changes-every-api-developer-should-know-in-2026-3hh8)) — process-wide flags `--allow-fs-read=`, `--allow-fs-write=`, `--allow-child-process`, `--allow-net-unix`, env-var restrictions. Still flagged experimental in Node 26.1 (May 2026). Composes with Express trivially — startup flag, no code change. Mitigates accidental fs reads, child_process, native addons. Does **not** mitigate in-process logic bugs. Near-zero perf cost. Caveat: applies to the whole process, so Express app and every tool share one allowlist.
- **`node:vm`** — **not a sandbox**. [DEV write-up](https://dev.to/dendrite_soup/nodevm-is-not-a-sandbox-stop-using-it-like-one-2f74) is unambiguous; vm2 had repeated escapes ([Semgrep](https://semgrep.dev/blog/2026/calling-back-to-vm2-and-escaping-sandbox/)). Skip.
- **`isolated-vm`** — real V8 isolate, separate heap, no shared prototype chain ([repo](https://github.com/laverdet/isolated-vm)). Non-trivial setup; the maintainer recommends running isolates in a _different_ Node process from your critical infra. Only useful if we want to run plugin / user-supplied tool code, not for first-party handlers.
- **Child process with reduced privileges** — spawn each tool call under `srt` or a dropped-UID `setuid` wrapper. ~10–50ms per call. Mitigates fs and network escapes (this is what Claude Code does for its bash tool — [code.claude.com/docs/sandboxing](https://code.claude.com/docs/en/sandboxing)). Doesn't compose naturally with the "tool handler is just an Express controller method" model unless we add a fork-on-call mode.
- **Docker / Firecracker / gVisor** — strongest isolation, historically 100–400ms cold-start (now 3–8ms for Firecracker snapshots per [techbytes.app](https://techbytes.app/posts/micro-vm-snapshots-vs-v8-isolates-serverless-2026/)). Operationally heavy; not realistic to wedge into a library — we'd be telling users "run kickjs inside Docker", which they already can.
- **Deno permissions / Bun** — Deno's permission broker model is mature ([docs](https://docs.deno.com/runtime/fundamentals/security/)) and now supports an external `DENO_PERMISSION_BROKER_PATH` decision process. Bun has no permission model in 2026 ([oven-sh/bun#25929](https://github.com/oven-sh/bun/issues/25929), [#26637](https://github.com/oven-sh/bun/issues/26637)) — explicitly de-prioritised.
- **Per-tool RBAC + capability tokens** — pure application logic, mitigates _authorization_ threats (not code-execution). Cheap and high-value.

**Theatre vs real:** `node:vm` and naive path-string validation (the EscapeRoute pattern) are theatre. Node `--experimental-permission`, OS-level srt-style wrappers, and capability tokens are real.

## 4. Approval / human-in-the-loop patterns at the server

- **Elicitation** is the only in-band, spec-blessed gating primitive.
- **Out-of-band approval over Slack/Telegram/email** — real implementations: [gotoHuman](https://mcpservers.org/servers/gotohuman/gotohuman-mcp-server) (managed async approval queue + webhooks + UI), [AskOnSlackMCP](https://mcpservers.org/servers/trtd56/AskOnSlackMCP), [Slack Webhook MCP](https://mcpservers.org/servers/SilasReinagel/slack-notify-mcp), AWS Step Functions blueprints for healthcare ([AWS blog](https://aws.amazon.com/blogs/machine-learning/human-in-the-loop-constructs-for-agentic-workflows-in-healthcare-and-life-sciences/)), nNode AI's Slack/Telegram approval gates ([nnode.ai](https://www.nnode.ai/blog/2026-02-05-human-in-the-loop-approval-gates)). Pattern is uniform: tool call returns "pending", emits a webhook, polls or waits for callback, then resumes.
- **Signed approval tokens (JIT capabilities)** — described as the "Scope Challenge / Elicitation Flow" pattern ([TianPan](https://tianpan.co/blog/2026-05-07-mcp-ambient-authority-tool-chaining), [Aembit](https://aembit.io/blog/mcp-authentication-and-authorization-patterns/)). Server halts on a sensitive call, mints a short-lived single-use token bound to the operation (and optionally to a hash of the tool description at approval time, defeating post-approval rug-pulls). Pattern, not spec primitive — no MCP standard yet.
- **Two-call dry-run + commit** — `tool.preview` returns a diff, `tool.commit(previewId)` executes. No standardisation; common in CRUD-style MCP servers.
- **Preloop** — commercial enterprise platform that proxies MCP and adds policy-as-code + human approvals + audit ([listing](https://mcpservers.org/servers/preloop/preloop)). Confirms market direction: approval is a gateway concern.
- **Two-person rule / time-bound grants** — could not find a concrete MCP-server implementation as of May 2026. Mentioned as patterns in Aembit and TianPan posts; no shipping code.

## Recommendations for kickjs

Ordered by value-per-effort given that kickjs already runs as Express middleware.

### 1. Ship tool annotations as decorator options now (~1 day)

Add `readOnly`, `destructive`, `idempotent`, `openWorld` to `@McpTool` and emit on `tools/list`. Zero runtime cost, immediate UX improvement in Claude Desktop / VS Code / Cursor approval prompts. Defaults safe (`destructive: true`, `openWorld: true`).

```ts
@McpTool({ name: 'list_invoices', readOnly: true, openWorld: false })
```

### 2. Wire `McpAuthOptions.validate` to RFC 9728 properly (~2-3 days)

Emit `/.well-known/oauth-protected-resource` from the adapter, return `WWW-Authenticate: Bearer resource_metadata="..."` on 401, and call `validate(token)` for every request — populate `ctx.session` with the resolved principal. Spec-compliant path; unblocks Auth0 / Okta / Keycloak integration without building auth infra.

### 3. Add an elicitation API to the request context (~3-5 days)

```ts
const confirmed = await ctx.mcp.elicit({
  message: `Delete invoice ${id}?`,
  schema: z.object({ confirm: z.boolean() }),
})
if (!confirmed.confirm) return ctx.forbidden()
```

Highest-leverage server-side gate available in-spec today. Costs a JSON-RPC roundtrip wrapper. A `@RequireConfirmation()` method decorator on top is trivial.

### 4. Capability tokens + dry-run/commit as a first-class decorator (~1 week)

Build on (3): `@TwoPhase()` auto-generates a `preview` variant that returns a signed, TTL-bound token (HMAC over `{tool, args-hash, principal, exp}`); the real call requires presenting that token. Defeats prompt-injection chaining far more effectively than client UI approval (which trusts the displayed args, not what actually executes). No spec dependency.

### 5. Document — don't reimplement — process sandboxing

Recommend `@anthropic-ai/sandbox-runtime` for users who want OS-level filesystem/network restrictions, and document Node `--experimental-permission` startup flags. Do **not** ship a `node:vm`-based sandbox or string-based path validation — that's the EscapeRoute trap. If we ever want in-process untrusted execution (plugins, user-supplied tool bodies), `isolated-vm` in a worker process is the only credible option, but as a separate package, not a default.

### Skip explicitly

- Building a kickjs-native gateway/proxy — Microsoft and Kuadrant already cover that segment
- Two-person-rule plumbing — no demand signal found in shipping projects
- Any `node:vm`-based "sandbox" — well-documented theatre

## Sources

- [MCP spec: Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation), [Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization), [Sampling](https://modelcontextprotocol.io/specification/draft/client/sampling), [Roots](https://modelcontextprotocol.io/specification/2025-06-18/client/roots)
- [MCP blog: Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
- [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [Cymulate — EscapeRoute (CVE-2025-53109 / 53110)](https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/), [Embrace The Red](https://embracethered.com/blog/posts/2025/anthropic-filesystem-mcp-server-bypass/)
- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime), [Claude Code Sandboxing docs](https://code.claude.com/docs/en/sandboxing)
- [Cloudflare — Code Mode](https://blog.cloudflare.com/code-mode/), [Dynamic Workers](https://blog.cloudflare.com/dynamic-workers/)
- [FastMCP profile](https://mcpmarket.com/server/fastmcp-12), [Mastra MCPServer](https://mastra.ai/reference/tools/mcp-server), [mcp-deno-sandbox](https://github.com/bewt85/mcp-deno-sandbox)
- [Microsoft mcp-gateway](https://github.com/microsoft/mcp-gateway), [Kuadrant mcp-gateway authorization](https://github.com/Kuadrant/mcp-gateway/blob/main/docs/guides/authorization.md), [Kong — What is an MCP Gateway](https://konghq.com/blog/learning-center/what-is-a-mcp-gateway)
- [Node.js Permissions API](https://nodejs.org/api/permissions.html), [2026 changes](https://dev.to/1xapi/5-nodejs-permission-model-changes-every-api-developer-should-know-in-2026-3hh8)
- [isolated-vm](https://github.com/laverdet/isolated-vm), [node:vm is not a sandbox](https://dev.to/dendrite_soup/nodevm-is-not-a-sandbox-stop-using-it-like-one-2f74), [Semgrep on vm2 escapes](https://semgrep.dev/blog/2026/calling-back-to-vm2-and-escaping-sandbox/)
- [Deno security](https://docs.deno.com/runtime/fundamentals/security/), [Bun permissions #25929](https://github.com/oven-sh/bun/issues/25929), [#26637](https://github.com/oven-sh/bun/issues/26637)
- [gotoHuman MCP](https://mcpservers.org/servers/gotohuman/gotohuman-mcp-server), [AskOnSlackMCP](https://mcpservers.org/servers/trtd56/AskOnSlackMCP), [Slack Webhook MCP](https://mcpservers.org/servers/SilasReinagel/slack-notify-mcp), [Preloop](https://mcpservers.org/servers/preloop/preloop)
- [TianPan — MCP Ambient Authority](https://tianpan.co/blog/2026-05-07-mcp-ambient-authority-tool-chaining), [Aembit — MCP auth patterns](https://aembit.io/blog/mcp-authentication-and-authorization-patterns/)
- [GitHub blog — elicitation in Copilot](https://github.blog/ai-and-ml/github-copilot/building-smarter-interactions-with-mcp-elicitation-from-clunky-tool-calls-to-seamless-user-experiences/), [VS Code elicitation](https://den.dev/blog/vscode-mcp-elicitations-stop-guessing/)
