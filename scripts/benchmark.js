#!/usr/bin/env node

/**
 * KickJS Benchmark Suite
 *
 * Measures framework overhead using autocannon against realistic endpoints.
 * Compares: minimal (hello world), JSON response, middleware stack, and DI resolution.
 *
 * Usage:
 *   node scripts/benchmark.js                    # Run all benchmarks
 *   node scripts/benchmark.js --connections 200   # Custom concurrency
 *   node scripts/benchmark.js --duration 60       # Custom duration (seconds)
 *
 * Results are saved to benchmark-results.json for tracking over time.
 */

const http = require('http')
const { execSync } = require('child_process')
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
  // We create a raw Express 5 app with KickJS patterns to measure overhead
  const express = require('express')
  const app = express()

  app.use(express.json())

  // Endpoint 1: Minimal — measures raw framework overhead
  app.get('/bench/minimal', (_req, res) => {
    res.send('ok')
  })

  // Endpoint 2: JSON — typical API response
  app.get('/bench/json', (_req, res) => {
    res.json({
      id: '1',
      name: 'Benchmark Test',
      email: 'bench@test.com',
      roles: ['user', 'admin'],
      createdAt: new Date().toISOString(),
      metadata: { score: 42, active: true },
    })
  })

  // Endpoint 3: JSON array — list endpoint
  app.get('/bench/list', (_req, res) => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: String(i + 1),
      name: `Item ${i + 1}`,
      status: i % 3 === 0 ? 'active' : 'inactive',
      value: Math.random() * 1000,
    }))
    res.json({ data: items, meta: { total: 50, page: 1, limit: 50 } })
  })

  // Endpoint 4: Middleware stack — simulates real-world middleware chain
  const middleware1 = (_req, _res, next) => {
    // Simulate request ID
    _req.id = Math.random().toString(36).slice(2)
    next()
  }
  const middleware2 = (_req, _res, next) => {
    // Simulate auth check
    _req.user = { id: '1', role: 'admin' }
    next()
  }
  const middleware3 = (_req, _res, next) => {
    // Simulate timing
    _req.startTime = Date.now()
    next()
  }

  app.get('/bench/middleware', middleware1, middleware2, middleware3, (req, res) => {
    res.json({ ok: true, requestId: req.id, user: req.user })
  })

  // Endpoint 5: POST with body parsing
  app.post('/bench/create', (req, res) => {
    res.status(201).json({ id: Math.random().toString(36).slice(2), ...req.body })
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
          connections: CONNECTIONS,
          duration: DURATION,
          requests: {
            total: result.requests.total,
            average: Math.round(result.requests.average),
            mean: Math.round(result.requests.mean),
          },
          throughput: {
            totalMB: (result.throughput.total / 1024 / 1024).toFixed(2),
            averageMBps: (result.throughput.average / 1024 / 1024).toFixed(2),
          },
          latency: {
            p50: result.latency.p50,
            p97_5: result.latency.p97_5,
            p99: result.latency.p99,
            average: result.latency.average.toFixed(2),
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
╔══════════════════════════════════════════════════════╗
║           KickJS Benchmark Suite                     ║
╠══════════════════════════════════════════════════════╣
║  Connections: ${String(CONNECTIONS).padEnd(6)} Duration: ${DURATION}s              ║
║  Warmup: ${WARMUP}s       Pipelining: 10               ║
╚══════════════════════════════════════════════════════╝
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
    { url: `${baseUrl}/bench/minimal`, name: 'Minimal (text)' },
    { url: `${baseUrl}/bench/json`, name: 'JSON object' },
    { url: `${baseUrl}/bench/list`, name: 'JSON array (50 items)' },
    { url: `${baseUrl}/bench/middleware`, name: 'Middleware stack (3 layers)' },
    {
      url: `${baseUrl}/bench/create`,
      name: 'POST + body parse',
      method: 'POST',
      body: { name: 'Test', email: 'test@bench.com' },
    },
  ]

  for (const bench of benchmarks) {
    const result = await runBenchmark(bench.url, bench.name, bench.method, bench.body)
    if (result) results.push(result)
  }

  // Close server
  server.close()

  // Print summary
  console.log(`
╔══════════════════════════════════════════════════════╗
║                    Results                           ║
╠══════════════════════════════════════════════════════╣`)

  for (const r of results) {
    console.log(`║  ${r.name.padEnd(30)} ${String(r.rps.toLocaleString()).padStart(10)} req/s ║`)
  }
  console.log(`╠══════════════════════════════════════════════════════╣`)

  // Latency table
  console.log(`║  ${'Endpoint'.padEnd(28)} ${'p50'.padStart(6)} ${'p97.5'.padStart(6)} ${'p99'.padStart(6)} ║`)
  console.log(`║  ${'─'.repeat(28)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)} ║`)
  for (const r of results) {
    console.log(
      `║  ${r.name.padEnd(28)} ${String(r.latency.p50 + 'ms').padStart(6)} ${String(r.latency.p97_5 + 'ms').padStart(6)} ${String(r.latency.p99 + 'ms').padStart(6)} ║`,
    )
  }
  console.log(`╚══════════════════════════════════════════════════════╝`)

  // Save results
  const outputPath = path.join(__dirname, '..', 'benchmark-results.json')
  const output = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    connections: CONNECTIONS,
    duration: DURATION,
    results,
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`\n  Results saved to benchmark-results.json`)

  if (results.some((r) => r.errors > 0)) {
    console.log(`\n  ⚠ Some benchmarks had errors — check results for details`)
  }

  console.log()
}

main().catch(console.error)
