---
'@forinda/kickjs-cli': patch
---

`kick new --template inertia --runtime fastify|h3`: the generated `pages.test.ts` boots the app on its own engine. It passed no runtime, so `createTestApp` used Express — not installed in a Fastify or h3 app — and both tests failed. Shared scaffold files now get only the imports they use and don't already write, so the test can take the runtime slot without inheriting the entry file's imports.
