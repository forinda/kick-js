# Benchmarks

## Benchmarking Your App

Use [autocannon](https://github.com/mcollina/autocannon) to load-test your KickJS application:

```bash
# Install autocannon
pnpm add -D autocannon

# Start your app
kick dev

# In another terminal — 100 concurrent connections for 30 seconds
npx autocannon http://localhost:3000/api/v1/users -c 100 -d 30

# Quick test — 50 connections, 10 seconds
npx autocannon http://localhost:3000/api/v1/users -c 50 -d 10
```

### Metrics to Watch

| Metric | What it tells you |
|---|---|
| **Req/s** | Throughput — requests handled per second |
| **p50** | Median latency — half of requests are faster than this |
| **p97.5** | Tail latency — 97.5% of requests are faster |
| **p99** | Worst-case latency — only 1% are slower |
| **Errors** | Failed requests under load |

### Tips for Accurate Results

- Run with `NODE_ENV=production` — Express disables debugging features
- Close other applications to reduce CPU contention
- Run multiple times and compare median results
- Use a consistent machine for tracking regressions
- Don't compare across different hardware

## Framework Reference Numbers

The KickJS monorepo includes a benchmark suite that measures framework overhead. These numbers are from the repo's internal tests, not something you run in your app.

Results vary by machine. Reference from a typical dev machine (Node 24, Linux):

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
- KickJS's decorator/DI layer adds negligible overhead over raw Express 5
