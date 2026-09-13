/** One client process for bench/run.mjs: open connections, wait for "go", run echo + fan-out. */
import { WebSocket } from 'ws'

const cfg = JSON.parse(process.argv[2])
const clock = () => performance.timeOrigin + performance.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const percentile = (xs, p) => {
  if (!xs.length) return 0
  xs.sort((a, b) => a - b)
  return +xs[Math.min(xs.length - 1, Math.floor(xs.length * p))].toFixed(2)
}

const echoLat = []
const fanLat = []
let echoSent = 0
let fanSent = 0

function open(i) {
  const port = cfg.ports[(cfg.offset * cfg.conns + i) % cfg.ports.length]
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/bench`)
    ws.on('message', (raw) => {
      const { event, data } = JSON.parse(raw)
      if (event === 'echo') echoLat.push(clock() - data.t)
      else if (event === 'fan') fanLat.push(clock() - data.t)
    })
    ws.once('open', () => resolve(ws))
    ws.once('error', () => resolve(null))
  })
}

const started = performance.now()
const sockets = []
for (let i = 0; i < cfg.conns; i += 100) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(100, cfg.conns - i) }, (_, j) => open(i + j)),
  )
  sockets.push(...batch.filter(Boolean))
}
const connectMs = Math.round(performance.now() - started)

process.send({ connected: sockets.length })
await new Promise((r) => process.once('message', r))

const timers = []
if (cfg.echoRate > 0) {
  for (const ws of sockets) {
    const every = 1000 / cfg.echoRate
    setTimeout(() => {
      timers.push(
        setInterval(() => {
          echoSent++
          ws.send(JSON.stringify({ event: 'echo', data: { t: clock() } }))
        }, every),
      )
    }, Math.random() * every)
  }
}
if (cfg.fanRate > 0) {
  timers.push(
    setInterval(() => {
      fanSent++
      sockets[0].send(JSON.stringify({ event: 'fan', data: { t: clock() } }))
    }, 1000 / cfg.fanRate),
  )
}

// Client CPU, so a saturated client is not mistaken for a slow server.
const cpuStart = process.cpuUsage()
const phaseStart = performance.now()

await sleep(cfg.seconds * 1000)
timers.forEach(clearInterval)
const cpu = process.cpuUsage(cpuStart)
const clientCpuPct = Math.round(
  ((cpu.user + cpu.system) / 1e3 / (performance.now() - phaseStart)) * 100,
)

// Drain until the backlog stops arriving (1s quiet, 20s cap): a frame that is
// merely late must not be counted as lost.
let seen = -1
for (let waited = 0; waited < 20000 && seen !== echoLat.length + fanLat.length; waited += 1000) {
  seen = echoLat.length + fanLat.length
  await sleep(1000)
}

process.send({
  done: true,
  connected: sockets.length,
  connectMs,
  clientCpuPct,
  echoSent,
  echoReceived: echoLat.length,
  echoP50: percentile(echoLat, 0.5),
  echoP99: percentile(echoLat, 0.99),
  fanSent,
  fanReceived: fanLat.length,
  fanP50: percentile(fanLat, 0.5),
  fanP99: percentile(fanLat, 0.99),
})
for (const ws of sockets) ws.terminate()
process.exit(0)
