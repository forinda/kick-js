---
layout: home
hero:
  name: KickJS
  text: Decorator-driven Node.js framework
  tagline: The DX of NestJS without the weight. TypeScript, Express 5, Zod, and decorators.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/forinda/kick-js

features:
  - title: Dependency Injection
    details: Custom lightweight container with constructor injection, property injection, factory registration, and lifecycle hooks.
  - title: Decorator-Driven
    details: "@Controller, @Get, @Post, @Service, @Autowired, @Middleware — all the patterns you know from Spring Boot and NestJS."
  - title: Zod-Native Validation
    details: Validation schemas double as OpenAPI documentation. No class-transformer or class-validator needed.
  - title: Vite HMR
    details: Zero-downtime hot reload in development. Preserves database pools, Redis connections, and Socket.IO state.
  - title: DDD Code Generators
    details: "kick g module users scaffolds entity, repository, service, use-cases, DTOs, and controller in seconds."
  - title: Auto OpenAPI
    details: Swagger UI and ReDoc generated automatically from your decorators and Zod schemas. Pluggable schema parsers.
  - title: Pluggable Architecture
    details: Adapters for database, auth, cache. QueryBuilderAdapter for Drizzle, Prisma, Sequelize. SchemaParser for Zod, Yup, Joi.
  - title: Extensible CLI
    details: "Register project-specific commands in kick.config.ts — db:migrate, proto:gen, seed, and more."
---
