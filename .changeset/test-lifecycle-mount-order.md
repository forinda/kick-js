---
'@forinda/kickjs': patch
---

test(http): lock in Application middleware lifecycle mount order

Adds a dedicated test file (`__tests__/lifecycle-mount-order.test.ts`) that exercises every documented step of `Application.setup()` and asserts the runtime mount order through the real Express stack. Six cases:

- `beforeMount` → `register()` → `beforeStart` hooks fire during `setup()` in adapter / plugin declaration order
- `afterStart` only fires under `start()`, never `setup()` (the documented contract for `createTestApp` compatibility)
- Per-request middleware fires in phase order: `beforeGlobal` (adapter) → plugin → user-declared global → `afterGlobal` (adapter) → `beforeRoutes` (adapter) → route handler
- `afterRoutes` middleware does fire when a request falls through to the 404 handler — guards against accidentally short-circuiting the chain
- Multiple adapters within the same phase fire in `dependsOn`-topological order at runtime (cascading from the existing construction-time sort to per-phase execution)
- Plugin middleware fires before user-declared global middleware (§3c precedes §4)

No production behaviour change — pure regression coverage for previously untested lifecycle contracts.
