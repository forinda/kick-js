/** One realtime server instance for bench/run.mjs. Reports CPU and RSS to the parent. */
import 'reflect-metadata'
import http from 'node:http'
import { Container } from '@forinda/kickjs'
import { WsAdapter, WsController, OnConnect, OnMessage } from '@forinda/kickjs-ws'

class BenchController {
  connect(ctx) {
    ctx.join('room')
  }
  echo(ctx) {
    ctx.send('echo', ctx.data)
  }
  fan(ctx) {
    ctx.to('room').send('fan', ctx.data)
  }
}
// Decorators applied by hand so this runs as plain node, no TS transform.
OnConnect()(BenchController.prototype, 'connect')
OnMessage('echo')(BenchController.prototype, 'echo')
OnMessage('fan')(BenchController.prototype, 'fan')
WsController('/bench')(BenchController)

// REDIS_URL set: instances share rooms through the Redis broker.
let broker
if (process.env.REDIS_URL) {
  const { default: Redis } = await import('ioredis')
  const { redisBroker } = await import('@forinda/kickjs-ws/redis')
  const publisher = new Redis(process.env.REDIS_URL)
  broker = redisBroker({ publisher, subscriber: publisher.duplicate() })
}

const port = Number(process.argv[2])
const server = http.createServer()
const adapter = WsAdapter({ heartbeatInterval: 0, broker })
await adapter.beforeStart({ container: Container.getInstance() })
await adapter.afterStart({ server })
await new Promise((resolve) => server.listen(port, resolve))

let last = process.cpuUsage()
let lastAt = performance.now()
let peakCpu = 0
let peakRssMb = 0
setInterval(() => {
  // Divide by real elapsed time: a saturated loop fires this late, and a fixed
  // 1s denominator then reports several seconds of CPU as one.
  const now = process.cpuUsage()
  const at = performance.now()
  const cpu = Math.round(
    ((now.user - last.user + now.system - last.system) / 1e3 / (at - lastAt)) * 100,
  )
  last = now
  lastAt = at
  peakCpu = Math.max(peakCpu, cpu)
  peakRssMb = Math.max(peakRssMb, Math.round(process.memoryUsage.rss() / 1048576))
  if (process.connected) process.send({ stats: { peakCpuPct: peakCpu, peakRssMb } })
}, 1000).unref()

process.send({ ready: true })
