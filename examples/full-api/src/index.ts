import 'reflect-metadata'
import express from 'express'
import cookieParser from 'cookie-parser'
import { bootstrap, requestId, csrf } from '@forinda/kickjs-http'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'
import { HealthAdapter } from './adapters/health.adapter'
import { requestLogger } from './middleware/request-logger'

/**
 * Full API example -- "kitchen sink" reference showing how all KickJS
 * features compose together in a single application.
 *
 * Features demonstrated:
 *   - Middleware pipeline (requestId, json parsing, cookie parsing, CSRF, logging)
 *   - CSRF protection with double-submit cookie pattern
 *   - Adapters (HealthAdapter, SwaggerAdapter)
 *   - File uploads via @FileUpload + upload.single()
 *   - Query string parsing via ctx.qs()
 *   - Swagger/OpenAPI auto-generation from decorators
 *   - Structured logging via createLogger
 */
bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  // -- Adapters ---------------------------------------------------------------
  // Adapters hook into the application lifecycle. They can mount routes
  // (beforeMount), contribute middleware at specific phases, and react
  // to route mounting (onRouteMount) for things like OpenAPI generation.
  adapters: [
    new HealthAdapter(),
    new SwaggerAdapter({
      info: {
        title: 'Full API Kitchen Sink',
        version: '1.0.0',
        description: 'Reference implementation showing all KickJS features together',
      },
      docsPath: '/docs',
      redocPath: '/redoc',
      specPath: '/openapi.json',
    }),
  ],

  // -- Middleware pipeline -----------------------------------------------------
  // When you provide `middleware`, you control exactly what runs and in what
  // order. If omitted, KickJS applies sensible defaults (requestId + json).
  middleware: [
    // -- Security & parsing (uncomment to add helmet/cors/compression) --
    // helmet(),          // Sets security headers (install: npm i helmet)
    // cors(),            // CORS handling (install: npm i cors)
    // compression(),     // Gzip/brotli response compression (install: npm i compression)

    // Request ID -- generates a unique X-Request-Id header per request
    requestId(),

    // JSON body parsing with a generous limit for document payloads
    express.json({ limit: '5mb' }),

    // Cookie parsing -- required for CSRF double-submit cookie pattern
    cookieParser(),

    // CSRF protection -- validates X-CSRF-Token header against _csrf cookie.
    // Webhook paths are excluded so external services can POST without a token.
    csrf({
      ignorePaths: ['/api/v1/webhooks'],
      cookieOptions: {
        httpOnly: true,
        sameSite: 'strict',
        secure: false, // set to true in production behind HTTPS
      },
    }),

    // Request logging -- logs method, URL, status, and duration
    requestLogger(),
  ],
})
