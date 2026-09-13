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

| Metric     | What it tells you                                      |
| ---------- | ------------------------------------------------------ |
| **Req/s**  | Throughput — requests handled per second               |
| **p50**    | Median latency — half of requests are faster than this |
| **p97.5**  | Tail latency — 97.5% of requests are faster            |
| **p99**    | Worst-case latency — only 1% are slower                |
| **Errors** | Failed requests under load                             |

### Tips for Accurate Results

- Run with `NODE_ENV=production` — Express disables debugging features
- Close other applications to reduce CPU contention
- Run multiple times and compare median results
- Use a consistent machine for tracking regressions
- Don't compare across different hardware

## Framework Reference Numbers

The KickJS monorepo includes a benchmark suite that measures framework overhead. These numbers are from the repo's internal tests, not something you run in your app.

Results vary by machine. Reference from a typical dev machine (Node 24, Linux):

| Endpoint                    | Req/s   | p50  | p97.5 | p99  |
| --------------------------- | ------- | ---- | ----- | ---- |
| Minimal (text)              | ~13,000 | 35ms | 50ms  | 59ms |
| JSON object                 | ~12,700 | 38ms | 50ms  | 57ms |
| JSON array (50 items)       | ~8,600  | 56ms | 80ms  | 88ms |
| Middleware stack (3 layers) | ~12,600 | 38ms | 51ms  | 58ms |
| POST + body parse           | ~9,200  | 53ms | 64ms  | 76ms |

Key takeaways:

- Middleware overhead is minimal (~5% for 3 layers)
- JSON serialization is the main cost for large responses
- KickJS's decorator/DI layer adds negligible overhead over raw Express 5

## WebSockets

`@forinda/kickjs-ws` ships a load test in `packages/ws/bench/`. It starts one or more server instances and several client processes, so clients never share the server's event loop. Each run has two phases:

- **echo** — every connection sends at a fixed rate and the server replies; measures round-trip latency.
- **fan-out** — one connection broadcasts to a room every other connection has joined; measures delivery latency and **reach** (deliveries received ÷ deliveries expected).

```bash
pnpm --filter @forinda/kickjs-ws build
cd packages/ws

pnpm bench                                             # 1 instance, 2,000 connections
CONNS=10000 WORKERS=8 ECHO_RATE=0 FAN_RATE=5 pnpm bench
INSTANCES=2 CONNS=10000 WORKERS=8 pnpm bench
```

| Variable    | Default | Meaning                                              |
| ----------- | ------- | ---------------------------------------------------- |
| `INSTANCES` | `1`     | Server processes; connections are spread evenly      |
| `CONNS`     | `2000`  | Total connections                                    |
| `WORKERS`   | `4`     | Client processes                                     |
| `SECONDS`   | `10`    | Length of the measured phase                         |
| `ECHO_RATE` | `1`     | Messages per second, per connection                  |
| `FAN_RATE`  | `20`    | Broadcasts per second from the single sender         |
| `BASE_PORT` | `4600`  | First server port                                    |
| `REDIS_URL` | unset   | When set, instances share rooms via the Redis broker |

The output includes client CPU. If it approaches 100%, the clients are the bottleneck — raise `WORKERS` before reading the server numbers.

### Reference numbers

Node 24.20, Linux, 12 cores. Each server process is one event loop, so it saturates at ~100% CPU. Client CPU stayed under 25% in every run.

| Scenario (1 instance)                    | Throughput       | p50    | p99   | Memory |
| ---------------------------------------- | ---------------- | ------ | ----- | ------ |
| 10,000 connections, echo                 | 9,000 msg/s      | 0.17ms | 14ms  | 299MB  |
| 20,000 connections, echo                 | 18,000 msg/s     | 1ms    | 128ms | 428MB  |
| 20,000 connections, echo (overloaded)    | 38,000 msg/s     | 1.0s   | 2.1s  | 481MB  |
| 10,000-member room, fan-out              | 50,000 frames/s  | 142ms  | 255ms | 269MB  |
| 10,000-member room, fan-out (overloaded) | 100,000 frames/s | 1.8s   | 4.1s  | 270MB  |

No run lost a message; overloaded runs delivered late. Once a process is past its ceiling, latency grows with the backlog rather than frames being dropped.

### Running more than one instance

Set `REDIS_URL` to run the instances with the [Redis broker](./websockets.md#scaling-across-instances):

```bash
docker run -d --rm -p 6379:6379 redis
REDIS_URL=redis://127.0.0.1:6379 INSTANCES=2 CONNS=10000 WORKERS=8 ECHO_RATE=0 FAN_RATE=5 pnpm bench
```

One 10,000-member room, spread evenly across instances, local Redis. These rows were measured in one session, so they compare with each other rather than with the table above.

| Scenario                | Frames/s | Reach   | p50   | p99   |
| ----------------------- | -------- | ------- | ----- | ----- |
| 1 instance              | 50,000   | 1.0     | 125ms | 178ms |
| 1 instance + Redis      | 50,000   | 1.0     | 141ms | 184ms |
| 2 instances, no broker  | 50,000   | **0.5** | 44ms  | 92ms  |
| 2 instances + Redis     | 50,000   | 1.0     | 85ms  | 201ms |
| 1 instance (overloaded) | 100,000  | 1.0     | 1.8s  | 2.7s  |
| 4 instances + Redis     | 100,000  | 1.0     | 58ms  | 203ms |

- Without a broker, each instance reaches only its own sockets, so half the room never gets the message.
- The broker costs one Redis round trip per broadcast, not per recipient — ~16ms p50 in the single-instance runs here.
- A load that swamps one process is handled by four with room to spare: server CPU stayed under 70% per instance.
