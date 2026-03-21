# Validated API

**What it shows:** Query parsing, rich validation, and OpenAPI documentation.

- `ctx.qs()` query parser with filtering, sorting, pagination
- `QueryFieldConfig` to restrict filterable/sortable fields
- Rich Zod schemas with enums, optionals, defaults, transforms
- Full Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`)
- Auto-generated OpenAPI spec from Zod schemas

## Running

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build
cd examples/validated-api
pnpm dev
```

[View source on GitHub](https://github.com/forinda/kick-js/tree/main/examples/validated-api)
