#!/usr/bin/env node

/**
 * KickJS Benchmark Suite
 *
 * Self-contained load testing script using autocannon.
 * Starts a minimal KickJS-style Express 5 app, runs benchmarks, then shuts down.
 *
 * Routes tested:
 *   GET  /api/v1/json         — returns { ok: true }
 *   GET  /api/v1/echo/:id     — returns { id: params.id }
 *   POST /api/v1/validate     — Zod body validation
 *
 * Usage:
 *   node scripts/benchmark.js                    # Run all benchmarks
 *   node scripts/benchmark.js --connections 200   # Custom concurrency
 *   node scripts/benchmark.js --duration 60       # Custom duration (seconds)
 *
 * Results are saved to benchmarks/results.json for tracking over time.
 */

const http = require('http')
const path = require('path')
const fs = require('fs')

// ── Configuration ───────────────────────────────────────────────────────

const args = process.argv.slice(2)
const CONNECTIONS = getArg('--connections', 100)
const DURATION = getArg('--duration', 30)
const WARMUP = 5 // seconds
const PORT = 4567

function getArg(name, defaultVal) {
  const idx = args.indexOf(name)
  return idx !== -1 ? parseInt(args[idx + 1], 10) : defaultVal
}

// ── Test Server ─────────────────────────────────────────────────────────

function createTestServer() {
  const express = require('express')
  const { z } = require('zod')
  const app = express()

  app.use(express.json())

  // Route 1: GET /api/v1/json — returns { ok: true }
  app.get('/api/v1/json', (_req, res) => {
    res.json({ ok: true })
  })

  // Route 2: GET /api/v1/echo/:id — returns { id: params.id }
  app.get('/api/v1/echo/:id', (req, res) => {
    res.json({ id: req.params.id })
  })

  // Route 3: POST /api/v1/validate — Zod body validation
  const validateSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    age: z.number().int().min(0).max(150).optional(),
  })

  app.post('/api/v1/validate', (req, res) => {
    const result = validateSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ errors: result.error.flatten().fieldErrors })
      return
    }
    res.json({ validated: true, data: result.data })
  })

  return app
}

// ── Benchmark Runner ────────────────────────────────────────────────────

async function runBenchmark(url, name, method = 'GET', body = undefined) {
  const autocannon = require('autocannon')

  // Warmup
  process.stdout.write(`  Warming up ${name}...`)
  await new Promise((resolve) => {
    const instance = autocannon(
      {
        url,
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        connections: 10,
        duration: WARMUP,
      },
      resolve,
    )
    autocannon.track(instance, { renderProgressBar: false })
  })
  process.stdout.write(' done\n')

  // Actual benchmark
  process.stdout.write(`  Running ${name} (${CONNECTIONS}c, ${DURATION}s)...`)
  return new Promise((resolve) => {
    const instance = autocannon(
      {
        url,
        method,
        body: body ? JSON.stringify(body) : undefined,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        connections: CONNECTIONS,
        duration: DURATION,
        pipelining: 10,
      },
      (err, result) => {
        if (err) {
          console.error(`\n  Error: ${err.message}`)
          resolve(null)
          return
        }

        const summary = {
          name,
          url,
          method,
          connections: CONNECTIONS,
          duration: DURATION,
          requests: {
            total: result.requests.total,
            average: Math.round(result.requests.average),
            mean: Math.round(result.requests.mean),
          },
          throughput: {
            totalMB: +(result.throughput.total / 1024 / 1024).toFixed(2),
            averageMBps: +(result.throughput.average / 1024 / 1024).toFixed(2),
          },
          latency: {
            p50: result.latency.p50,
            p95: result.latency.p97_5, // autocannon reports p97.5; closest to p95
            p99: result.latency.p99,
            average: +result.latency.average.toFixed(2),
            max: result.latency.max,
          },
          errors: result.errors,
          timeouts: result.timeouts,
          rps: Math.round(result.requests.average),
        }

        process.stdout.write(` ${summary.rps.toLocaleString()} req/s\n`)
        resolve(summary)
      },
    )
    autocannon.track(instance, { renderProgressBar: false })
  })
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`
+======================================================+
|           KickJS Benchmark Suite                      |
+======================================================+
|  Connections: ${String(CONNECTIONS).padEnd(6)} Duration: ${String(DURATION).padEnd(4)}s             |
|  Warmup: ${WARMUP}s       Pipelining: 10                  |
+------------------------------------------------------+
`)

  // Start server
  const app = createTestServer()
  const server = http.createServer(app)

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`  Server running on port ${PORT}\n`)
      resolve()
    })
  })

  const baseUrl = `http://localhost:${PORT}`
  const results = []

  // Run benchmarks
  const benchmarks = [
    { url: `${baseUrl}/api/v1/json`, name: 'GET /api/v1/json' },
    { url: `${baseUrl}/api/v1/echo/42`, name: 'GET /api/v1/echo/:id' },
    {
      url: `${baseUrl}/api/v1/validate`,
      name: 'POST /api/v1/validate',
      method: 'POST',
      body: { name: 'Test User', email: 'test@bench.com', age: 25 },
    },
  ]

  for (const bench of benchmarks) {
    const result = await runBenchmark(bench.url, bench.name, bench.method, bench.body)
    if (result) results.push(result)
  }

  // Close server
  await new Promise((resolve) => server.close(resolve))

  // Print summary
  console.log(`
+======================================================+
|                    Results                            |
+------------------------------------------------------+`)

  for (const r of results) {
    console.log(`|  ${r.name.padEnd(30)} ${String(r.rps.toLocaleString()).padStart(10)} req/s |`)
  }

  console.log(`+------------------------------------------------------+`)
  console.log(`|  ${'Endpoint'.padEnd(28)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} |`)
  console.log(`|  ${''.padEnd(28, '-')} ${''.padEnd(6, '-')} ${''.padEnd(6, '-')} ${''.padEnd(6, '-')} |`)
  for (const r of results) {
    console.log(
      `|  ${r.name.padEnd(28)} ${String(r.latency.p50 + 'ms').padStart(6)} ${String(r.latency.p95 + 'ms').padStart(6)} ${String(r.latency.p99 + 'ms').padStart(6)} |`,
    )
  }
  console.log(`+------------------------------------------------------+`)

  // Throughput table
  console.log(`|  ${'Endpoint'.padEnd(28)} ${'Avg MB/s'.padStart(10)} ${'Total MB'.padStart(10)} |`)
  console.log(`|  ${''.padEnd(28, '-')} ${''.padEnd(10, '-')} ${''.padEnd(10, '-')} |`)
  for (const r of results) {
    console.log(
      `|  ${r.name.padEnd(28)} ${String(r.throughput.averageMBps).padStart(10)} ${String(r.throughput.totalMB).padStart(10)} |`,
    )
  }
  console.log(`+======================================================+`)

  // Save results
  const benchDir = path.join(__dirname, '..', 'benchmarks')
  if (!fs.existsSync(benchDir)) {
    fs.mkdirSync(benchDir, { recursive: true })
  }

  const outputPath = path.join(benchDir, 'results.json')
  const output = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    connections: CONNECTIONS,
    duration: DURATION,
    results,
  }

  // Append to history if file exists, otherwise create new
  let history = []
  if (fs.existsSync(outputPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'))
      history = Array.isArray(existing) ? existing : [existing]
    } catch {
      // corrupted file, start fresh
    }
  }
  history.push(output)

  fs.writeFileSync(outputPath, JSON.stringify(history, null, 2))
  console.log(`\n  Results saved to benchmarks/results.json`)

  if (results.some((r) => r.errors > 0)) {
    console.log(`\n  WARNING: Some benchmarks had errors - check results for details`)
  }

  console.log()
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})
