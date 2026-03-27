# Inspiration

KickJS exists because I wanted to contribute something meaningful to the JavaScript ecosystem — a backend framework that brings together the best patterns I've seen across different languages and communities, and makes them accessible in one place.

## Why KickJS?

Every framework is opinionated. Rails has its way. Spring Boot has its way. NestJS has its way. KickJS is no different — it's a collection of patterns and practices I've encountered across frontend and backend ecosystems, shaped into something I believe makes building Node.js APIs enjoyable and productive.

This isn't a claim that KickJS is the *only* way or the *best* way. It's *a* way — one that works well for the kinds of applications I've built, and hopefully for yours too.

## Standing on the Shoulders of Giants

KickJS wouldn't exist without the incredible work of others:

- **[TanStack](https://tanstack.com)** — Tanner Linsley's suite of tools showed me what great developer experience looks like. The way TanStack Router, Query, and Table are designed — framework-agnostic, type-safe, composable — is a constant source of inspiration for how KickJS approaches pluggability and DX.

- **Spring Boot** — The decorator-driven DI model (`@Service`, `@Controller`, `@Autowired`, `@Inject`) that makes KickJS feel familiar to Java developers came directly from studying Spring's elegant approach to inversion of control.

- **NestJS** — Proved that decorators and DI can work beautifully in TypeScript. KickJS borrows from its module system and guard patterns while staying closer to Express's simplicity.

- **Laravel** — The artisan CLI (`kick new`, `kick g`, `kick tinker`), the adapter philosophy, and the idea that a framework should ship with *everything* you need — auth, mail, queues, caching, scheduling — all trace back to Laravel's "batteries included" approach.

- **Vue.js** — The reactivity system (`ref`, `computed`, `watch`) in KickJS is directly inspired by Vue's Composition API. Vue proved that reactivity isn't just for the frontend.

- **Express.js** — KickJS is built *on* Express 5, not *instead of* it. Express is the foundation — KickJS adds structure on top without hiding it.

## The Philosophy

The core idea behind KickJS is **adaptability**. Every major subsystem — auth, caching, cron, mail, queues, templates, databases — is defined by an interface, not an implementation. You pick the pieces that fit your project:

- Use JWT or API keys or OAuth or Passport.js or your own auth
- Use Redis cache or in-memory or build your own
- Use BullMQ or RabbitMQ or Kafka or Redis Pub/Sub for queues
- Use Drizzle or Prisma or Mongoose or raw SQL
- Use croner or node-cron or your own scheduler

The framework provides the patterns. You provide the choices.

## A Personal Note

I built KickJS because I genuinely believe the Node.js backend ecosystem deserves more tools that are thoughtfully designed, well-documented, and pleasant to use. The frontend world has an embarrassment of riches — incredible routing, state management, component libraries, build tools. The backend side is catching up, and I want to be part of that journey.

This project may not be perfect. There are rough edges, and there's always room to improve. But every line was written with care, and every API was designed with the developer experience in mind.

If you find KickJS useful, please leave a star on [GitHub](https://github.com/forinda/kick-js) — it means more than you know. And if you have ideas for how to make it better, open an issue or a PR. This is as much your framework as it is mine.

Let's build something great together.

— [**Felix Orinda**](https://github.com/forinda)
