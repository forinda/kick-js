# Inspiration

KickJS exists because I wanted to contribute something meaningful to the JavaScript ecosystem — a backend framework that brings together the best patterns I've seen across different languages and communities, and makes them accessible in one place.

## Why KickJS?

Every framework is opinionated. Rails has its way. Spring Boot has its way. NestJS has its way. KickJS is no different — it's a collection of patterns and practices I've encountered across frontend and backend ecosystems, shaped into something I believe makes building Node.js APIs enjoyable and productive.

This isn't a claim that KickJS is the *only* way or the *best* way. It's *a* way — one that works well for the kinds of applications I've built, and hopefully for yours too.

## Standing on the Shoulders of Giants

KickJS wouldn't exist without the incredible work of others.

### Vite Ecosystem

We studied 6 frameworks in the Vite ecosystem to understand how modern tools solve the dev experience problem. Each taught us something different:

- **[React Router](https://reactrouter.com)** — Showed that Vite should own the dev server. Let the build tool handle the port, HMR, and module loading — your framework just plugs in. Simple, no conflicts.

- **[TanStack Start](https://tanstack.com/start)** — Pioneered virtual modules as a first-class pattern. Instead of manually registering every file, the framework discovers and imports them for you.

- **[Vinxi](https://vinxi.vercel.app)** — Demonstrated how to persist state across hot reloads. Database connections and long-lived resources should survive code changes — the dev server shouldn't drop them.

- **[H3 / Nuxt](https://h3.unjs.io)** — Elegant approach to swapping request handlers without restarting the server. Seamless transitions during development.

- **[AdonisJS](https://adonisjs.com)** — Full-stack TypeScript framework that proved Node.js can have a Laravel-quality experience with type safety.

### Classic Inspirations

- **[Spring Boot](https://spring.io/projects/spring-boot)** — The decorator-driven DI model that makes KickJS feel familiar to Java developers. Elegant inversion of control with clear, declarative patterns.

- **[NestJS](https://nestjs.com)** — Proved that decorators and DI can work beautifully in TypeScript. Module system and guard patterns that scale from small APIs to large applications.

- **[Laravel](https://laravel.com)** — The idea that a framework should ship with *everything* you need — auth, mail, queues, caching, scheduling. Plus an artisan-inspired CLI that scaffolds entire features.

- **[Vue.js](https://vuejs.org)** — The Composition API proved that reactivity isn't just for the frontend. Clean, composable state management that works anywhere.

- **[Express.js](https://expressjs.com)** — The foundation. KickJS is built *on* Express 5, not *instead of* it. We add structure on top without hiding the tool underneath.

- **[TanStack](https://tanstack.com)** — Framework-agnostic, type-safe, composable — Tanner Linsley's suite of tools is a masterclass in developer experience and pluggable design.

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
