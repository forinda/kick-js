# KickJS Roadmap — v6 and beyond

> Internal planning document. Subject to change. Status reflects April 2026.
> Source for prioritisation: [`backend-gaps.md`](./backend-gaps.md) — research
> on Node backend pain points across StateofJS, HN, Reddit, BullMQ + OTel
> issue trackers, and SOC 2 / GDPR posts (late 2025 / early 2026).

This roadmap picks four themed milestones that close the highest-leverage gaps the framework has bones for. Each milestone ships independently — no big-bang releases. Anything not on this list is intentionally deferred (see "Deferred to v7+" at the bottom).

---

## Theme 1 — Type-safe end-to-end (v6.0)

**Closes:** [Gap #1 — E2E type safety without code generation](./backend-gaps.md#1-end-to-end-type-safety-without-code-generation)

The single feature that moves KickJS from "another Express framework" to "shows up in the tRPC / Hono RPC comparison post". The Vite typegen primitive already does the hard part (decorator scanning); we just don't emit a client artifact yet.

**Ships:**

- `kick typegen client` — emits a typed `createClient<App>()` artifact derived from `@Controller` + `@Get` + Zod `validate()` schemas. Frontend imports as `workspace:*`; no separate generation step in CI.
- Generic `RouteShape<TController>` helper on the framework side so the artifact stays under 100 lines.
- Vitest contract test that diffs the generated client surface across PRs (catches breaking route changes at review time, not deploy time).
- Docs page: "Typed clients without OpenAPI" — comparison vs. tRPC, Hono RPC, oRPC.

**Non-goals:**

- No client transport opinion (axios / fetch / undici — adopters pick).
- No subscription/streaming layer here — that lives in Theme 2.

**Status:** not started. Vite typegen scanner in `packages/cli/src/typegen/scanner.ts` is the foundation.

---

## Theme 2 — AI-native primitives (v6.x)

**Closes:** [Gap #2 — AI streaming + tool calls](./backend-gaps.md#2-ai-era-backends-streaming-tool-calls-and-sse-plumbing) and the [token observability honorable mention](./backend-gaps.md#honorable-mentions)

KickJS already ships an AI adapter and a Model Context Protocol server. What it doesn't ship is the connective tissue (`@Stream()`, `defineTool()`, token cost telemetry) that makes "AI-shaped backends" — copilots, RAG endpoints, agent loops — first-class. Vercel AI SDK and Mastra dominate because they ship these primitives.

**Ships:**

- `@Stream()` decorator — auto-flushes a `RequestContext`-aware SSE writer. Handles `Transfer-Encoding: chunked`, AbortController propagation, and partial-JSON repair. Reuses Context Contributors for tenant/session injection.
- `defineTool({ params: z.object(...), handler })` — single registration that exposes a function to (a) the existing MCP server, (b) the AI adapter's local agent loop, and (c) DevTools introspection.
- `tokenMeter()` adapter — wraps the AI adapter, emits per-request token counts and dollar estimates as structured events. Pluggable sink (pino / OTel span attribute / custom).
- `@DurableHandler()` — for agent runs that span minutes; under the hood, drains via the queue adapter so a disconnected client can resume.
- New example app: `examples/copilot-api` — a small assistant endpoint demonstrating streaming + tools + token meter in <200 LOC.

**Non-goals:**

- No prompt-template DSL. Prompts are strings; if you want a DSL bring one.
- No vector store adapter — every team picks a different one (Pinecone / Chroma / pgvector / Qdrant). BYO recipe instead.

**Status:** AI adapter (`@forinda/kickjs-ai`) and MCP (`@forinda/kickjs-mcp`) ship today; both need the decorator surface above.

---

## Theme 3 — Production correctness (v6.x)

**Closes:** [Gap #3 idempotency](./backend-gaps.md#3-idempotency-keys-and-exactly-once-semantics), [Gap #4 graceful shutdown](./backend-gaps.md#4-graceful-shutdown-and-lifecycle-correctness), [Gap #8 jobs as first-class](./backend-gaps.md#8-background-jobs-as-a-first-class-concept-not-just-a-queue)

Every payments / agents / webhooks team copy-pastes the same Redis idempotency middleware. Every K8s deploy drops in-flight work because shutdown ordering is wrong. Every BullMQ user re-discovers retry storms. These are framework problems with framework-shaped solutions.

**Ships:**

- `@Idempotent({ ttl, keySource })` decorator backed by a pluggable `IdempotencyStore` token. Replays cached response bodies on duplicate keys. Adapters for Memory / Redis / Postgres ship in v6.0; users register their own via the standard token pattern.
- `bootstrap({ shutdown: { phases } })` — formalises the existing `shutdown()` hook into ordered phases (`drainHttp` → `drainWorkers` → `closeWs` → `closePools`) with adapter-declared dependencies. Ships with `terminus()`-style readiness/liveness routes registered via DevTools introspection.
- `@Job({ idempotencyKey, retries, deadLetter, drainOn })` decorator on `@forinda/kickjs-queue` — composes Theme 3 #1 (idempotency) + #2 (shutdown drain) so cron→job→dead-letter is one decorator chain.
- DevTools panel: in-flight jobs / failed / scheduled, with retry / requeue / kill actions. Already have the introspection bus.
- Decision: queue v5 slim shape ([`packages/queue/v5-design.md`](./packages/queue/v5-design.md)) — accept or scrap. The orchestration layer above sits cleanly on either, but the multi-provider abstraction shouldn't compete with the new decorator surface.

**Non-goals:**

- No in-house queue backend. BullMQ / RabbitMQ / Kafka adapters cover it.
- No distributed lock primitive. Adopters who need one wire Redlock via the existing DI pattern; KickJS doesn't ship a half-correct version.

**Status:** `bootstrap({ processHooks })` and adapter `shutdown()` exist; queue ships today. Both need the higher-level decorator surface.

---

## Theme 4 — Decorator future-proofing (v6.x prep, v7 cutover)

**Closes:** [Gap #7 — Stage 3 vs experimental decorators](./backend-gaps.md#7-decorator-standardisation-stage-3-vs-experimental)

This is the existential one. TypeScript 5.0+ ships Stage 3 standard decorators. Node is on track to support them natively, which would _break_ every framework that depends on `experimentalDecorators` + `reflect-metadata` — including KickJS, Nest, TypeORM. The teams with a Stage 3 surface ready collect the Nest refugees.

**Ships in v6:**

- A parallel Stage 3 decorator surface behind `@forinda/kickjs/stage3` — same API names, no `reflect-metadata` dependency.
- Vite typegen extended to emit the DI metadata that `reflect-metadata` used to provide at runtime. (The build step sees what the runtime can no longer reflect.)
- `kick codemod stage3` — automates `experimentalDecorators` → Stage 3 migration in adopter projects. Worst-case we own the migration UX rather than ceding it to a community tool.
- Compatibility note in docs explaining the timeline: when Node ships Stage 3 by default, the experimental surface freezes; v7 makes Stage 3 the default and ships a final release of the experimental surface for migration.

**Cuts in v7:**

- Drop `experimentalDecorators` + `reflect-metadata` from `@forinda/kickjs`. The Stage 3 surface becomes default.

**Non-goals:**

- No stub / shim layer that pretends both work transparently. Adopters opt in per-package.

**Status:** not started. Tracking [nodejs/node#60282](https://github.com/nodejs/node/issues/60282) for the upstream timeline.

---

## Cross-cutting work (lands across all themes)

These don't justify their own milestone but show up as deliverables under the others:

- **Testing harness depth** ([Gap #10](./backend-gaps.md#10-testing-harnesses-that-dont-get-copy-pasted)) — `withFixtures()`, `mockAdapter()`, automatic per-test `Container.create()`, HTTP fixture record/replay. Lands as needed under each theme — Theme 1 needs the contract diff; Theme 3 needs `mockAdapter` for shutdown-phase tests.
- **Observability convergence** ([Gap #5](./backend-gaps.md#5-observability-without-four-tools)) — partial: `tokenMeter()` from Theme 2 + readiness probes from Theme 3 are pieces of the answer. The full `defineObservability({ logs, traces, metrics, errors })` adapter is deferred to v7 where it can absorb the Stage 3 changes too.
- **Webhook receivers** (honorable mention) — `@Webhook({ provider: 'stripe' })` with HMAC + replay protection. Small surface; lands under Theme 3 when convenient.
- **Feature flags** (honorable mention) — BYO recipe in v6.x docs. Decorator can wait for v7 when we know which provider abstraction stuck.

---

## Deferred to v7+

Explicitly not in v6 scope. Each one has rationale.

| Gap                                                                                                   | Why deferred                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [#6 Multi-runtime / Bun adapter](./backend-gaps.md#6-multi-runtime-portability-without-maximalism)    | Real demand exists but Bun's HTTP shape is moving; lock in after Bun 2.0.                                       |
| [#9 Audit + PII redaction](./backend-gaps.md#9-audit-logging-and-pii-redaction-as-a-built-in-concern) | Needs a stable Stage 3 decorator surface to attach to (Theme 4).                                                |
| [#5 Unified observability adapter](./backend-gaps.md#5-observability-without-four-tools)              | Best landed as one piece, not bolted onto v6 themes.                                                            |
| Module-level RBAC                                                                                     | `@Roles` per-handler covers the 90%; module-level lands when an adopter opens an issue with the concrete shape. |
| Schema migrations as health check                                                                     | Owned by Prisma / Drizzle teams; framework involvement risks fragmentation.                                     |
| Async secret pulls (Doppler/SOPS/AWS SM)                                                              | BYO via `definePlugin` — recipe in v6.x docs.                                                                   |

---

## What's explicitly off the roadmap

These come up in every "what should KickJS do next" conversation. The answer is no, and [the gap research backs the call](./backend-gaps.md#what-not-to-chase):

- Replacing Express 5 wholesale.
- Multi-runtime maximalism (Workers + Deno + Bun + Node simultaneously).
- A built-in ORM.
- A full GraphQL stack (deprecated in v5; stays BYO).
- A bespoke logging or metrics library.
- An Effect-style algebraic effect system.
- A managed cloud (Encore-style infrastructure provisioning).

---

## Sequencing

```
v6.0  ──  Theme 1 (typed client) + Theme 3 idempotency
v6.1  ──  Theme 2 (streaming + tools + tokenMeter)
v6.2  ──  Theme 3 shutdown ordering + @Job orchestration
v6.3  ──  Theme 4 Stage 3 surface behind flag + codemod
v7.0  ──  Stage 3 default, experimental surface frozen, audit + observability convergence
v7.x  ──  Bun adapter
```

Each milestone is a minor release; v7 is the next breaking-change vehicle (Stage 3 cutover is the trigger, not a marketing target).

---

## Related

- [`backend-gaps.md`](./backend-gaps.md) — full gap research with sources
- [`comparison.md`](./comparison.md) — KickJS vs Nest / Fastify / Hono / AdonisJS
- [`docs/guide/migration-v4-to-v5.md`](./docs/guide/migration-v4-to-v5.md) — most recent breaking-change migration; Theme 4 will look similar in shape
- [`packages/queue/v5-design.md`](./packages/queue/v5-design.md) — open design decision feeding Theme 3
