# Examples

KickJS ships with example applications that demonstrate different features and patterns. Each example was scaffolded using the CLI (`kick new` + `kick g module`) and then customized.

## basic-api

**What it shows:** Core framework usage with DDD module structure.

- `@Controller`, `@Get`, `@Post`, `@Put`, `@Delete` decorators
- `@Autowired` property injection
- Use-case pattern with domain services
- In-memory repository with Symbol-based DI tokens
- Swagger UI at `/docs`
- Health check adapter

[View source](https://github.com/forinda/kick-js/tree/main/examples/basic-api)

## auth-api

**What it shows:** Authentication and authorization patterns.

- JWT-like auth middleware using `@Middleware` decorator
- Protected routes (class-level and method-level auth)
- Public endpoints that opt out of auth
- Login/register endpoints with token generation
- User context extraction from tokens

[View source](https://github.com/forinda/kick-js/tree/main/examples/auth-api)

## validated-api

**What it shows:** Query parsing, rich validation, and OpenAPI documentation.

- `ctx.qs()` query parser with filtering, sorting, pagination
- `QueryFieldConfig` to restrict filterable/sortable fields
- Rich Zod schemas with enums, optionals, defaults, transforms
- Full Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`)
- Auto-generated OpenAPI spec from Zod schemas

[View source](https://github.com/forinda/kick-js/tree/main/examples/validated-api)

## full-api

**What it shows:** All framework features composed together.

- CSRF protection with `csrf()` middleware
- File upload with `upload.single()` and `cleanupFiles()`
- Full middleware pipeline (requestId, JSON parser, cookie parser, CSRF)
- Health check adapter
- Request logging middleware
- Swagger with all decorators
- Query parsing with field restrictions

[View source](https://github.com/forinda/kick-js/tree/main/examples/full-api)

## Running Examples

```bash
# Clone the repo
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install
pnpm build

# Run any example
cd examples/basic-api
pnpm dev
```

## Creating Your Own

```bash
npx @forinda/kickjs-cli new my-api
cd my-api
pnpm install
pnpm kick g module users
pnpm kick dev
```
