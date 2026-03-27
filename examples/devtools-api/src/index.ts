import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { ref, computed, watch } from '@forinda/kickjs'
import { createLogger } from '@forinda/kickjs/logger'
import { modules } from './modules'

const log = createLogger('DevToolsExample')

// ── Custom reactive state ────────────────────────────────────────────
// Demonstrate using reactivity outside the DevToolsAdapter

const peakConcurrency = ref(0)
const activeConcurrency = ref(0)
const peakValue = computed(() => peakConcurrency.value)

watch(activeConcurrency, (current) => {
  if (current > peakConcurrency.value) {
    peakConcurrency.value = current
  }
})

watch(peakConcurrency, (peak) => {
  log.info(`New peak concurrency: ${peak}`)
})

// Concurrency tracking middleware
const concurrencyTracker = () => {
  return (_req: any, res: any, next: any) => {
    activeConcurrency.value++
    res.on('finish', () => {
      activeConcurrency.value--
    })
    next()
  }
}

// ── DevTools adapter ────────────────────────────────────────────────
const devtools = new DevToolsAdapter({
  // Defaults to disabled in production (NODE_ENV=production).
  // Remove `enabled: true` to respect the default — never expose in prod.
  exposeConfig: true,
  configPrefixes: ['APP_', 'NODE_ENV', 'PORT'],
  errorRateThreshold: 0.3,
  onErrorRateExceeded: (rate) => {
    log.warn(`Alert: error rate at ${(rate * 100).toFixed(1)}%`)
  },
})

// Subscribe to request count for custom logging
devtools.requestCount.subscribe((count) => {
  if (count > 0 && count % 100 === 0) {
    log.info(`Milestone: ${count} requests served`)
  }
})

// ── Bootstrap ────────────────────────────────────────────────────────
bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    devtools,
    new SwaggerAdapter({
      info: {
        title: 'DevTools Example API',
        version: '1.0.0',
        description:
          'KickJS example demonstrating DevToolsAdapter and reactivity. ' +
          'Visit /_debug/metrics, /_debug/routes, /_debug/health, /_debug/state',
      },
    }),
  ],

  middleware: [requestId(), express.json({ limit: '1mb' }), concurrencyTracker()],
})
