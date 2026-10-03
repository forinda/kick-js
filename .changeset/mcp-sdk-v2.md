---
'@forinda/kickjs-mcp': major
---

Moves to MCP SDK v2 and protocol 2026-07-28, and adds resources and elicitation.

**Breaking:** the peer dependency is now `@modelcontextprotocol/server` `^2.3.0` instead of `@modelcontextprotocol/sdk`. Install it with `pnpm add @modelcontextprotocol/server` (or run `kick add mcp`), then remove `@modelcontextprotocol/sdk` unless you use it yourself. Tests that use the SDK client import `Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`.

- **Protocol 2026-07-28.** One endpoint serves both eras.
  - 2026-07-28 clients are served statelessly in either mode, and hear about list changes through `subscriptions/listen`.
  - 2025 clients keep their sessions, or get stateless serving under `stateless: true`.
  - Over stdio, the connection's first message picks the era.
- **Resources.** `registerResourceProvider({ name, resources, templates })` serves fixed URIs and RFC 6570 URI templates.
  - Reads can go through your own routes with `ctx.fetch`.
  - `resourceFilter` decides what each caller sees.
  - A resource's `scopes` answer 403 `insufficient_scope`.
  - Connected clients get `resources/list_changed`.
- **Elicitation.** A custom tool calls `ctx.elicit(key, { message, schema })` to ask the user mid-call, and gets the validated answer or `undefined`.
  - 2026-07-28 clients get `input_required` rounds; answers carried between rounds are HMAC-signed and bound to the caller.
  - 2025 sessions get real `elicitation/create` requests.
  - Set `requestStateKey` when several instances serve one endpoint.
- Unknown tools still answer `-32602`, now as `ProtocolError` from the v2 SDK.
