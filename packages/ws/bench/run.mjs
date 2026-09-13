/**
 * Realtime load test: N server instances, K client processes.
 *
 *   node bench/run.mjs                     # defaults
 *   INSTANCES=2 CONNS=4000 node bench/run.mjs
 *
 * Servers and clients run in separate processes so neither steals the other's
 * event loop. Each phase prints one JSON line per client worker, then a summary.
 */
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = (f) => fileURLToPath(new URL(f, import.meta.url))
const env = (k, d) => Number(process.env[k] ?? d)

const INSTANCES = env('INSTANCES', 1)
const WORKERS = env('WORKERS', 4)
const CONNS = env('CONNS', 2000)
const SECONDS = env('SECONDS', 10)
const ECHO_RATE = env('ECHO_RATE', 1) // msgs/sec per connection
const FAN_RATE = env('FAN_RATE', 20) // broadcasts/sec from one sender
const BASE_PORT = env('BASE_PORT', 4600)

const servers = []
const serverStats = new Map()
for (let i = 0; i < INSTANCES; i++) {
  const port = BASE_PORT + i
  const child = fork(here('./server.mjs'), [String(port)], {
    stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
  })
  servers.push(
    new Promise((resolve) =>
      child.on('message', (m) => {
        if (m.ready) resolve(child)
        if (m.stats) serverStats.set(port, m.stats)
      }),
    ),
  )
}
const children = await Promise.all(servers)
const ports = children.map((_, i) => BASE_PORT + i)

// Every worker connects first; the phase starts for all of them at once, so the
// fan-out sender never broadcasts to a room that is still filling.
let ready = 0
const workers = []
const results = await Promise.all(
  Array.from(
    { length: WORKERS },
    (_, w) =>
      new Promise((resolve, reject) => {
        const child = fork(here('./client.mjs'), [
          JSON.stringify({
            ports,
            conns: Math.ceil(CONNS / WORKERS),
            offset: w,
            seconds: SECONDS,
            echoRate: ECHO_RATE,
            // one sender in the whole run, on instance 0
            fanRate: w === 0 ? FAN_RATE : 0,
          }),
        ])
        workers.push(child)
        child.on('message', (m) => {
          if (m.done) return resolve(m)
          if (m.connected !== undefined && ++ready === WORKERS)
            for (const c of workers) c.send('go')
        })
        child.on('exit', (code) => code && reject(new Error(`client ${w} exited ${code}`)))
      }),
  ),
)

const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0)
const pct = (k) => Math.max(...results.map((r) => r[k] ?? 0))
const fanSent = results[0].fanSent
const connected = sum('connected')

console.log(
  JSON.stringify(
    {
      instances: INSTANCES,
      conns: connected,
      connectMs: pct('connectMs'),
      peakClientCpuPct: pct('clientCpuPct'),
      echo: {
        msgsPerSec: Math.round(sum('echoReceived') / SECONDS),
        p50: pct('echoP50'),
        p99: pct('echoP99'),
        lost: sum('echoSent') - sum('echoReceived'),
      },
      fan: {
        broadcasts: fanSent,
        expectedDeliveries: fanSent * connected,
        delivered: sum('fanReceived'),
        reach: +(sum('fanReceived') / (fanSent * connected || 1)).toFixed(3),
        p50: pct('fanP50'),
        p99: pct('fanP99'),
      },
      servers: Object.fromEntries(serverStats),
    },
    null,
    2,
  ),
)

for (const c of children) c.kill()
process.exit(0)
