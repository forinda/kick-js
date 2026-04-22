# @forinda/kickjs-swagger

Auto-generated OpenAPI spec from decorators + Zod schemas. Serves Swagger UI at `/docs`, ReDoc at `/redoc`, raw JSON at `/openapi.json`.

## Install

```bash
kick add swagger
```

## Quick Example

```ts
import { bootstrap } from '@forinda/kickjs'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    SwaggerAdapter({
      info: { title: 'My API', version: '1.0.0' },
      bearerAuth: true,
      disableInProd: true,
    }),
  ],
})
```

Decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiBearerAuth`, `@ApiExclude`) refine the generated spec. For non-Zod schemas, plug a custom `SchemaParser` (Joi, Yup, Valibot, etc.).

## Documentation

[forinda.github.io/kick-js/guide/swagger](https://forinda.github.io/kick-js/guide/swagger)

## License

MIT
