---
description: Testing work that happens outside a request in KickJS — background jobs, cron jobs, WebSockets and outgoing mail.
---

# Testing Jobs, Cron, WebSockets and Mail

Work that doesn't happen inside a request needs a different handle. The rule throughout: run the handler directly, and replace what talks to the outside world with a fake that records what it was asked to do.

## Background jobs

### Run a handler directly

A job handler is a method on a `@Job` class. `runJob` picks the `@Process` method for a job's name, resolves the class from the container and calls it, the same way a queue worker does:

```ts
import { runJob } from '@forinda/kickjs'

@Job('emails')
export class EmailJobs {
  constructor(private readonly mailer: MailerService) {}

  @Process('welcome')
  async welcome(job: { data: { to: string } }) {
    await this.mailer.send({ to: job.data.to, subject: 'Welcome' })
  }
}

it('sends the welcome mail', async () => {
  // fakeMailer: a MailerService that keeps what it sends — see Mail below.
  const { container } = await createTestApp({
    ...appOptions,
    overrides: [[MailerService, fakeMailer]],
  })

  await runJob(container, 'emails', { name: 'welcome', data: { to: 'ada@x.io' } })
  expect(fakeMailer.sent).toEqual([expect.objectContaining({ to: 'ada@x.io' })])
})
```

A job name no `@Process` method handles throws `NoJobHandlerError`, so a test catches a renamed job.

### Check what code enqueues

Code that enqueues injects `JOB_DISPATCHER`. Override it with a dispatcher that records:

```ts
import { JOB_DISPATCHER, type JobDispatcher } from '@forinda/kickjs'

const dispatched: Array<{ queue: string; name: string; data: unknown }> = []
const recording: JobDispatcher = {
  dispatch: async (queue, name, data) => {
    dispatched.push({ queue, name, data })
  },
}

it('enqueues the welcome mail on sign-up', async () => {
  const { client } = await createTestApp({
    ...appOptions,
    overrides: [[JOB_DISPATCHER, recording]],
  })

  await client().post('/api/v1/signup').send({ email: 'ada@x.io' }).expect(200)
  expect(dispatched).toEqual([{ queue: 'emails', name: 'welcome', data: { to: 'ada@x.io' } }])
})
```

The queue adapter is what binds a real dispatcher, so leave it out of test apps. A class that injects `JOB_DISPATCHER` then needs this override to resolve at all.

Together the two cover a job end to end: the endpoint enqueues the right job (recording dispatcher), and the handler does the right thing with it (`runJob`). Don't connect a test to Redis or BullMQ unless the queue's own behaviour (retries, delays) is what's under test.

## Cron jobs

`runCronJobs` runs `@Cron` jobs on demand, by name, schedule id or expression:

```ts
import { runCronJobs } from '@forinda/kickjs'

@Service()
export class Reports {
  @Cron('0 * * * *')
  async hourly(run: CronRun) {
    // run.trigger is 'manual' here; 'schedule' when the scheduler fires it
  }
}

it('builds the hourly report', async () => {
  const { container } = await createTestApp(appOptions)

  const result = await runCronJobs(container, { name: 'Reports.hourly' }, 'manual')
  expect(result).toEqual({ ran: 1, failed: 0 })
})
```

- **Job names.** A job is named `<Class>.<method>` unless `@Cron` was given a `name`.
- **Failures.** `runCronJobs` never rejects: a throwing job counts in `failed`. To see the error, resolve the class and call the method yourself with a `CronRun`, `{ name, expression, meta: {}, firedAt: new Date(), trigger: 'manual' }`.
- **No real scheduling.** Jobs run on a schedule only through the cron adapter. Leave it out of test apps and nothing fires on its own. To test the job's logic over time, pass the date it should see through `firedAt` rather than faking timers.

## WebSockets

Sockets attach to a listening HTTP server, which `createTestApp` doesn't start. Start a real app on any free port instead, and connect a real client:

```ts
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { Application } from '@forinda/kickjs'
import { WsAdapter } from '@forinda/kickjs-ws'

let app: Application
let url: string

beforeAll(async () => {
  app = new Application({
    modules: [ChatModule()],
    adapters: [WsAdapter({ heartbeatInterval: 0 })],
    port: 0, // any free port
  })
  await app.start()
  const { port } = app.getHttpServer()!.address() as AddressInfo
  url = `ws://127.0.0.1:${port}/ws/chat`
})

afterAll(() => app.shutdown())

it('answers a ping', async () => {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))

  const reply = new Promise((resolve) => ws.once('message', (m) => resolve(JSON.parse(String(m)))))
  ws.send(JSON.stringify({ event: 'ping', data: {} }))
  expect(await reply).toEqual({ event: 'pong', data: { at: 'server' } })
  ws.close()
})
```

- **`heartbeatInterval: 0`** turns off the ping timer, which would otherwise keep the test process alive.
- **Socket.IO** works the same way with `SocketIoAdapter` and `socket.io-client`'s `io(url)`.
- **Handler logic** that doesn't need a socket can live in a service the gateway calls. Test that service directly; keep a few end-to-end socket tests like this one.

## Mail

Mail is your own service ([Mailer](../mailer.md)): the recipe binds a `MailerService` with a `send(message)` method. Tests replace it with one that keeps what was sent:

```ts
// tests/fakes/mailer.ts
import type { MailMessage } from '../../src/mailer'

export class FakeMailer {
  readonly sent: MailMessage[] = []
  async send(message: MailMessage) {
    this.sent.push(message)
  }
}

export const fakeMailer = new FakeMailer()
onTestReset(() => {
  fakeMailer.sent.length = 0
})
```

```ts
const t = useTestApp(() => ({ ...appOptions, overrides: [[MailerService, fakeMailer]] }))

it('mails a reset link', async () => {
  await t.client().post('/api/v1/password-reset').send({ email: 'ada@x.io' }).expect(202)
  expect(fakeMailer.sent).toEqual([expect.objectContaining({ to: 'ada@x.io' })])
})
```

The same shape fits anything that leaves the process: SMS, payments, webhooks, object storage. Use a fake that records, an override to install it, and `onTestReset` to clear it between files.
