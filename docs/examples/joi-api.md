# Joi Validation Example

Swagger integration using Joi schemas instead of Zod via a custom `SchemaParser`.

## Features

- Custom `SchemaParser` for Joi-to-OpenAPI conversion
- Joi validation schemas on controller methods
- Swagger UI at `/docs`

## Running

```bash
cd examples/joi-api
kick dev
```

Then visit `http://localhost:3000/docs` for the Swagger UI.

## Key Code

The custom schema parser converts Joi schemas to JSON Schema for OpenAPI:

```ts
import Joi from 'joi'
import joiToJson from 'joi-to-json'
import { type SchemaParser, SwaggerAdapter } from '@forinda/kickjs-swagger'

const joiParser: SchemaParser = {
  name: 'joi',
  supports: (schema) => Joi.isSchema(schema),
  toJsonSchema: (schema) => joiToJson(schema),
}

SwaggerAdapter({
  info: { title: 'Joi API', version: '1.0.0' },
  schemaParser: joiParser,
})
```

## Source

- [examples/joi-api/](https://github.com/forinda/kick-js/tree/main/examples/joi-api)
