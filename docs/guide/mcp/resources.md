---
description: Serve MCP resources from a KickJS app — fixed URIs and URI templates, reading through your own routes, per-caller filtering, scopes and change notifications.
---

# MCP Resources

A resource is something a client can read rather than call: a config file, an invoice, a report. Clients show resources to the user, or attach them to the model's context. Tools act; resources are read.

A **resource provider** is a named set of resources, mounted on the adapter at any time:

```ts
import { MCP_ADAPTER, type McpResourceProvider } from '@forinda/kickjs-mcp'

const invoices: McpResourceProvider = {
  name: 'invoices',
  resources: [
    // A fixed URI.
    { uri: 'config://billing', name: 'billing-config', read: () => 'currency=KES' },
  ],
  templates: [
    // A family of URIs (RFC 6570). `read` gets the template's variables.
    {
      uriTemplate: 'invoices://{id}',
      name: 'invoice',
      description: 'One invoice, as JSON',
      read: async ({ id }, ctx) => {
        const res = await ctx.fetch(
          new Request(new URL(`/api/v1/invoices/${id}`, ctx.origin), { headers: ctx.headers }),
        )
        return res.json()
      },
    },
  ],
}

container.resolve(MCP_ADAPTER).registerResourceProvider(invoices)
```

- **`read` returns the contents.** A string is sent as text (`text/plain` unless you set `mimeType`). A `Uint8Array` is sent as binary. Anything else is sent as JSON text (`application/json`). An object shaped like MCP read contents (`{ contents: [...] }`) is sent as is.
- **`ctx` works as it does in a custom tool:** `principal`, `origin`, `headers`, `signal`, and `fetch` into your own routes. Reading through a route keeps its guards and validation. Pass `ctx.headers` to keep the caller's credentials.
- **A template's `list(ctx)`** (optional) names concrete resources, so they appear in `resources/list` too. Without it, clients see only the template and fill in the variables.
- **URIs must be unique.** Mounting a URI or template that another provider already holds throws. Registering a provider under the same name replaces it.
- **Connected clients are told when the list changes.** 2025 sessions get `resources/list_changed`; 2026-07-28 clients get it on their `subscriptions/listen` stream.

## Who sees what

`resourceFilter` decides which resources a caller sees, like `toolFilter` does for tools. It applies to `resources/list`, `resources/templates/list` and `resources/read`, and a hidden resource reads as not found:

```ts
McpAdapter({
  name: 'billing',
  resourceFilter: (resource, call) =>
    resource.provider !== 'ledger' || call.principal?.scopes?.includes('ledger:read') === true,
})
```

`resource` is an `McpResourceSummary`: `kind` (`'resource'` or `'template'`), `name`, `uri` or `uriTemplate`, `scopes`, `provider`.

## Scopes

A resource or template can require scopes, as a tool can. A caller whose token lacks them gets 403 with an `insufficient_scope` challenge naming them, so an OAuth client can ask for more access ([Authentication](./auth.md)):

```ts
{ uri: 'ledger://trial-balance', name: 'trial-balance', scopes: ['ledger:read'], read: () => trialBalance() }
```

## Not covered

Prompts and resource subscriptions (`resources/subscribe`, per-URI update notifications) aren't supported yet.
