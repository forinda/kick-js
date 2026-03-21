# Benchmarks

KickJS includes a built-in benchmark suite powered by [autocannon](https://github.com/mcollina/autocannon) to measure HTTP performance and track regressions.

## Running Benchmarks

```bash
# Full benchmark (100 connections, 30s per endpoint)
pnpm bench

# Quick run (50 connections, 10s)
pnpm bench:quick

# Custom settings
pnpm bench -- --connections 200 --duration 60
```

Results are saved to `benchmark-results.json` for comparison over time.

## What's Tested

| Endpoint | Description |
|---|---|
| Minimal (text) | Raw `res.send('ok')` — measures base framework overhead |
| JSON object | Single object `res.json({...})` — typical API response |
| JSON array (50 items) | List endpoint with 50 items — serialization cost |
| Middleware stack (3 layers) | Request ID + auth + timing middleware — real-world chain |
| POST + body parse | `express.json()` + body parsing — write endpoint |

## Metrics

| Metric | What it tells you |
|---|---|
| **Req/s** | Throughput — requests handled per second |
| **p50** | Median latency — half of requests are faster than this |
| **p97.5** | Tail latency — 97.5% of requests are faster |
| **p99** | Worst-case latency — only 1% are slower |
| **Errors** | Failed requests under load |

## Sample Results

Results vary by machine. Here's a reference from a typical dev machine (Node 24, Linux):

| Endpoint | Req/s | p50 | p97.5 | p99 |
|---|---|---|---|---|
| Minimal (text) | ~13,000 | 35ms | 50ms | 59ms |
| JSON object | ~12,700 | 38ms | 50ms | 57ms |
| JSON array (50 items) | ~8,600 | 56ms | 80ms | 88ms |
| Middleware stack (3 layers) | ~12,600 | 38ms | 51ms | 58ms |
| POST + body parse | ~9,200 | 53ms | 64ms | 76ms |

Key takeaways:
- Middleware overhead is minimal (~5% for 3 layers)
- JSON serialization is the main cost for large responses
- These numbers reflect Express 5 performance — KickJS's decorator/DI layer adds negligible overhead

## Benchmarking Your App

You can benchmark your own KickJS app with autocannon directly:

```bash
# Install autocannon globally
pnpm add -g autocannon

# Start your app
pnpm dev

# In another terminal
autocannon http://localhost:3000/api/v1/users -c 100 -d 30
```

## Tips for Accurate Results

- Run with `NODE_ENV=production` — Express disables debugging features
- Close other applications to reduce CPU contention
- Run multiple times and compare median results
- Use a consistent machine for tracking regressions
- Don't compare across different hardware
