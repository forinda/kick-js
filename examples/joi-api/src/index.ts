/**
 * Joi API — demonstrates using Joi (instead of Zod) with KickJS Swagger.
 *
 * Key setup:
 *   1. Create a joiSchemaParser that implements SchemaParser
 *   2. Pass it to SwaggerAdapter via { schemaParser: joiSchemaParser }
 *   3. Use Joi schemas in @ApiResponse({ schema: joiSchema })
 *   4. Use joiValidate() middleware for request validation
 */
import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'
import { joiSchemaParser } from './parsers/joi-schema-parser'

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    new SwaggerAdapter({
      info: {
        title: 'Joi Validation API',
        version: '1.0.0',
        description: 'Demonstrates using Joi instead of Zod for validation and OpenAPI schema generation. '
          + 'Uses a custom SchemaParser to convert Joi schemas to JSON Schema.',
      },
      // This is the key line — swap the default Zod parser for Joi
      schemaParser: joiSchemaParser,
    }),
  ],

  middleware: [
    requestId(),
    express.json({ limit: '1mb' }),
  ],
})
