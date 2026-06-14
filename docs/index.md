---
layout: home

features:
  - icon: 🔌
    title: Pluggable HTTP Runtimes
    details: Run on Express, Fastify, or h3 — swap the engine in one line. Controllers, DI, and decorators never change.
    link: /guide/http-runtimes
    linkText: Choose an engine
  - icon: 🎯
    title: Decorator-Driven DI
    details: '@Controller, @Service, @Inject, @Cron, @Job — familiar patterns from Spring Boot and NestJS, with a zero-dependency DI container.'
    link: /guide/decorators
    linkText: Explore decorators
  - icon: 🗄️
    title: First-Class Database
    details: 'kick/db — code-first schema, fully typed queries, and migrations for PostgreSQL, SQLite, and MySQL. No ORM lock-in.'
    link: /guide/database/
    linkText: Model your data
  - icon: 🧬
    title: End-to-End Type Safety
    details: Typegen makes Ctx<KickRoutes.X> resolve params, body, and query from your routes — caught at compile time, never drifting.
    link: /guide/typegen
    linkText: See typegen
  - icon: 📤
    title: Uploads on Any Engine
    details: '@FileUpload → ctx.file / ctx.files with the same Multer shape on Express, Fastify, and h3. kick add upload wires the driver.'
    link: /guide/file-uploads
    linkText: Handle files
  - icon: 📚
    title: OpenAPI & Swagger
    details: Generate an OpenAPI spec plus Swagger UI and ReDoc straight from your decorators — docs that stay in sync with code.
    link: /guide/swagger
    linkText: Document your API
  - icon: 🔁
    title: Real-Time Built In
    details: WebSockets, Socket.IO, and Server-Sent Events are first-class — rooms, heartbeats, and ctx.sse() out of the box.
    link: /guide/websockets
    linkText: Go real-time
  - icon: ⏱️
    title: Jobs & Schedules
    details: Background queues over BullMQ, RabbitMQ, or Kafka, plus @Cron scheduling — the same decorator ergonomics as your routes.
    link: /guide/cron
    linkText: Run background work
  - icon: ✅
    title: Validation, Your Way
    details: Zod, Valibot, or Yup behind one KickSchema interface — env, request bodies, and OpenAPI all flow through it.
    link: /guide/validation
    linkText: Validate inputs
  - icon: ⚡
    title: Vite-Powered Dev
    details: Zero-downtime hot reload via Vite. Database connections, Redis, and WebSocket state survive code changes.
    link: /guide/hmr
    linkText: Feel the HMR
  - icon: 🛠
    title: CLI That Scaffolds Everything
    details: 'kick new, kick g module (minimal, REST, DDD, CQRS), kick add, kick doctor — scaffold an entire feature in seconds.'
    link: /guide/cli-commands
    linkText: Use the CLI
  - icon: 🧩
    title: Pluggable Everything
    details: Auth, mail, caching, notifications, OpenTelemetry — every subsystem is an interface. You pick the implementation.
    link: /guide/adapters
    linkText: Build adapters
---
