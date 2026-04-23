import { Queue, Worker, type Job as BullMQJob } from 'bullmq'
import {
  Logger,
  defineAdapter,
  Scope,
  getClassMetaOrUndefined,
  getClassMeta,
} from '@forinda/kickjs'
import {
  defineDevtoolsTab,
  PROTOCOL_VERSION,
  type DevtoolsTabDescriptor,
  type IntrospectionSnapshot,
} from '@forinda/kickjs-devtools-kit'
import {
  QUEUE_MANAGER,
  QUEUE_METADATA,
  jobRegistry,
  type QueueAdapterOptions,
  type ProcessDefinition,
} from './types'
import { QueueService } from './queue.service'

const log = Logger.for('QueueAdapter')

/**
 * Public extension methods exposed by a QueueAdapter instance — the
 * stats helpers DevTools consumes to render the queue dashboard.
 */
export interface QueueAdapterExtensions {
  /** Get all registered queue names (used by DevTools). */
  getQueueNames(): string[]
  /** Get stats for a specific queue (used by DevTools). */
  getQueueStats(name: string): Promise<Record<string, any>>
}

/**
 * BullMQ adapter for KickJS — creates queues and workers, wires @Job/@Process
 * decorated classes as job processors, and registers a QueueService in DI.
 *
 * @example
 * ```ts
 * import { QueueAdapter } from '@forinda/kickjs-queue'
 *
 * bootstrap({
 *   modules: [EmailModule],
 *   adapters: [
 *     QueueAdapter({
 *       redis: { host: 'localhost', port: 6379 },
 *       queues: ['email', 'notifications'],
 *       concurrency: 5,
 *     }),
 *   ],
 * })
 * ```
 */
export const QueueAdapter = defineAdapter<QueueAdapterOptions, QueueAdapterExtensions>({
  name: 'QueueAdapter',
  defaults: {
    queues: [],
    concurrency: 1,
  },
  build: (options) => {
    const workers: Worker[] = []
    const queueService = new QueueService()

    const getQueueNames = (): string[] => queueService.getQueueNames()

    const getQueueStats = async (name: string): Promise<Record<string, any>> => {
      const queue = queueService.getQueue(name)
      if (!queue) return { error: 'Queue not found' }
      try {
        const counts = await queue.getJobCounts()
        return {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
          paused: counts.paused ?? 0,
        }
      } catch {
        return { error: 'Stats unavailable' }
      }
    }

    return {
      getQueueNames,
      getQueueStats,

      // ── DevTools introspection (architecture.md §23) ─────────────
      // Cheap snapshot — counts only, no Redis round trip. The full
      // per-queue stats are still served via the existing
      // `/_debug/queues` endpoint for adopters who need them.
      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: PROTOCOL_VERSION,
          name: 'QueueAdapter',
          kind: 'adapter',
          state: {
            redisHost: options.redis.host,
            redisPort: options.redis.port,
          },
          tokens: { provides: ['kick/queue/Manager'], requires: [] },
          metrics: {
            registeredQueues: queueService.getQueueNames().length,
            activeWorkers: workers.length,
            registeredJobClasses: jobRegistry.size,
          },
        }
      },

      // ── DevTools custom tab (architecture.md §23) ────────────────
      // Iframe view pointing at our own /_kick/queue/panel endpoint
      // (mounted in beforeMount below). The DevTools panel embeds
      // the URL with `sandbox="allow-scripts allow-same-origin"` so
      // the page can call back to /_debug/queues for live data.
      devtoolsTabs(): DevtoolsTabDescriptor[] {
        return [
          defineDevtoolsTab({
            id: 'queue',
            title: 'Queue',
            category: 'modules',
            view: { type: 'iframe', src: '/_kick/queue/panel' },
          }),
        ]
      },

      // Mount the iframe panel route. Done in beforeMount (not
      // beforeStart) because we need the Express app, not the DI
      // container. Standalone HTML page — no framework, no build
      // step; bundled inline so adopters don't have to ship our
      // panel as a separate static asset.
      beforeMount({ app }) {
        app.get('/_kick/queue/panel', (_req, res) => {
          res.type('html').send(QUEUE_PANEL_HTML)
        })
        app.get('/_kick/queue/data', async (_req, res) => {
          const queues: Array<{
            name: string
            counts: Record<string, number> | { error: string }
          }> = []
          for (const name of queueService.getQueueNames()) {
            try {
              queues.push({ name, counts: (await getQueueStats(name)) as Record<string, number> })
            } catch (err) {
              queues.push({
                name,
                counts: { error: err instanceof Error ? err.message : String(err) },
              })
            }
          }
          res.json({ queues })
        })
      },

      beforeStart({ container }) {
        const { redis, queues: preCreateQueues = [], concurrency = 1 } = options

        const connection = { host: redis.host, port: redis.port, password: redis.password }

        // Pre-create any explicitly listed queues
        for (const name of preCreateQueues) {
          if (!queueService.getQueue(name)) {
            const queue = new Queue(name, { connection })
            queueService.registerQueue(name, queue)
          }
        }

        // Discover all @Job-decorated classes and wire workers
        for (const jobClass of jobRegistry) {
          const queueName = getClassMetaOrUndefined<string>(QUEUE_METADATA.JOB, jobClass)
          if (queueName === undefined) continue

          const handlers = getClassMeta<ProcessDefinition[]>(QUEUE_METADATA.PROCESS, jobClass, [])

          if (handlers.length === 0) {
            log.warn(
              `@Job('${queueName}') class ${jobClass.name} has no @Process methods — skipping`,
            )
            continue
          }

          // Ensure the queue exists
          if (!queueService.getQueue(queueName)) {
            const queue = new Queue(queueName, { connection })
            queueService.registerQueue(queueName, queue)
          }

          // Auto-register the @Job class if not already in the container.
          // @Service()/@Job() set metadata but don't always call container.register(),
          // especially after HMR rebuilds which reset the container.
          if (!container.has(jobClass)) {
            container.register(jobClass, jobClass)
          }

          // Resolve the processor instance from DI
          const processor = container.resolve(jobClass)

          // Build the worker processor function
          const worker = new Worker(
            queueName,
            async (job: BullMQJob) => {
              const specific = handlers.find((h) => h.jobName === job.name)
              const handler = specific || handlers.find((h) => h.jobName === undefined)

              if (handler) {
                await processor[handler.handlerName](job)
              } else {
                log.warn(`No handler for job "${job.name}" in queue "${queueName}"`)
              }
            },
            { connection, concurrency },
          )

          worker.on('failed', (job, err) => {
            log.error({ err }, `Job failed: ${queueName}/${job?.name} (id: ${job?.id})`)
          })

          worker.on('completed', (job) => {
            log.debug(`Job completed: ${queueName}/${job.name} (id: ${job.id})`)
          })

          workers.push(worker)
          log.info(
            `Worker started: ${queueName} (${jobClass.name}, ${handlers.length} handler(s), concurrency: ${concurrency})`,
          )
        }

        // Register the QueueService in DI
        container.registerFactory(QUEUE_MANAGER, () => queueService, Scope.SINGLETON)

        log.info(
          `QueueAdapter ready — ${queueService.getQueueNames().length} queue(s), ${workers.length} worker(s)`,
        )
      },

      async shutdown() {
        // Close workers first so they stop picking up new jobs
        for (const worker of workers) {
          await worker.close()
        }
        log.info(`Closed ${workers.length} worker(s)`)
        workers.length = 0

        // Then close queues
        await queueService.closeAll()
        log.info('All queues closed')
      },
    }
  },
})

/**
 * Self-contained HTML for the DevTools "Queue" iframe panel. Inlined
 * so the queue package doesn't have to ship a static-asset directory
 * — the panel works the moment the user opens DevTools.
 *
 * Polls /_kick/queue/data every 2 seconds for live counts. The script
 * builds the DOM via createElement / textContent (never innerHTML)
 * so queue names that happen to contain HTML-special characters can't
 * break out of the cell. Bare CSS picks up the parent panel's
 * color-scheme via `prefers-color-scheme` so dark/light mode flow
 * through without coordination.
 */
const QUEUE_PANEL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="color-scheme" content="dark light" />
<title>Queue panel</title>
<style>
  :root { color-scheme: dark light; }
  body {
    margin: 0; padding: 16px;
    background: light-dark(#fff, #0f1115);
    color: light-dark(#1c2030, #d8dde6);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  h1 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: light-dark(#5b6070, #7e8696); margin: 0 0 12px; }
  table { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid light-dark(#e2e6ee, #2a2f3d); text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: light-dark(#5b6070, #7e8696); }
  .empty { color: light-dark(#5b6070, #7e8696); font-style: italic; padding: 32px; text-align: center; }
  .error { color: #f87171; }
</style>
</head>
<body>
<h1>BullMQ queues</h1>
<div id="root" class="empty">Loading…</div>
<script type="module">
const root = document.getElementById('root');
const params = new URLSearchParams(location.search);
const token = params.get('token');
const COLS = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];

function makeMessage(text, isError) {
  const div = document.createElement('div');
  div.className = 'empty' + (isError ? ' error' : '');
  div.textContent = text;
  return div;
}

function makeCell(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function renderTable(queues) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(makeCell('th', 'Queue'));
  for (const c of COLS) headRow.appendChild(makeCell('th', c));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const q of queues) {
    const row = document.createElement('tr');
    row.appendChild(makeCell('td', q.name));
    if (q.counts && q.counts.error) {
      const errCell = makeCell('td', q.counts.error);
      errCell.colSpan = COLS.length;
      errCell.className = 'error';
      row.appendChild(errCell);
    } else {
      for (const c of COLS) row.appendChild(makeCell('td', String(q.counts[c] ?? 0)));
    }
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

async function tick() {
  try {
    const url = '/_kick/queue/data' + (token ? '?token=' + encodeURIComponent(token) : '');
    const res = await fetch(url, { headers: token ? { 'x-devtools-token': token } : {} });
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
    const data = await res.json();
    root.replaceChildren(
      data.queues.length === 0
        ? makeMessage('No queues registered yet.', false)
        : renderTable(data.queues),
    );
  } catch (err) {
    root.replaceChildren(makeMessage(err && err.message ? err.message : String(err), true));
  }
}

tick();
setInterval(tick, 2000);
</script>
</body>
</html>`
