# Basic API

**What it shows:** Core framework usage with DDD module structure.

- `@Controller`, `@Get`, `@Post`, `@Put`, `@Delete` decorators
- `@Autowired` property injection
- Use-case pattern with domain services
- In-memory repository with Symbol-based DI tokens
- Swagger UI at `/docs`
- Health check adapter

## Running

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build
cd examples/basic-api
pnpm dev
```

[View source on GitHub](https://github.com/forinda/kick-js/tree/main/examples/basic-api)
