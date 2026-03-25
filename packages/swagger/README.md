# @forinda/kickjs-swagger

Auto-generated OpenAPI spec from decorators, Swagger UI, and ReDoc for KickJS.

## Install

```bash
# Using the KickJS CLI (recommended)
kick add swagger

# Manual install
pnpm add @forinda/kickjs-swagger @forinda/kickjs-core
```

## Features

- `SwaggerAdapter` — serves Swagger UI at `/docs`, ReDoc at `/redoc`, JSON at `/openapi.json`
- Decorators: `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`, `@ApiExclude`
- Auto-converts Zod validation schemas to OpenAPI JSON Schema
- Pluggable `SchemaParser` — use Joi, Yup, Valibot instead of Zod
- Schemas registered in `components.schemas` for the Models section

## Quick Example

```typescript
import { SwaggerAdapter } from '@forinda/kickjs-swagger'

bootstrap({
  modules,
  adapters: [
    new SwaggerAdapter({
      info: { title: 'My API', version: '1.0.0' },
      bearerAuth: true,
    }),
  ],
})
```

### Custom Schema Parser (Joi)

```typescript
import { type SchemaParser } from '@forinda/kickjs-swagger'

const joiParser: SchemaParser = {
  name: 'joi',
  supports: (schema) => Joi.isSchema(schema),
  toJsonSchema: (schema) => joiToJson(schema),
}

new SwaggerAdapter({ schemaParser: joiParser })
```

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
