/**
 * Jobs — background work, in two views: **Scheduled** (every `@Cron` job,
 * whatever runs it) and **Queues** (queued jobs through a job tool's
 * `jobInspector()`). Opens on whichever has something; the choice is
 * remembered.
 */

import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
  type Component,
} from 'solid-js'
import { rpc, type CronJobEntry } from '../lib/rpc'
import { store, storeActions } from '../lib/store'
import { ago, formatMs, formatUptime } from '../lib/format'
import { QueuesTab } from './QueuesTab'

const VIEW_KEY = 'kickjs-devtools:jobs:view'
type View = 'scheduled' | 'queues'

function readView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'scheduled' || v === 'queues' ? v : null
  } catch {
    return null
  }
}

export const JobsTab: Component = () => {
  const [view, setView] = createSignal<View>(
    readView() ?? (store.cron().length || !store.queues().queues.length ? 'scheduled' : 'queues'),
  )
  const pick = (v: View): void => {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // storage unavailable — the choice lasts for this visit
    }
  }
  const button = (v: View, label: string, count: number) => (
    <button
      type="button"
      aria-pressed={view() === v}
      onClick={() => pick(v)}
      class={`rounded-md border px-2.5 py-0.5 text-xs font-semibold ${
        view() === v
          ? 'border-kick-500/30 bg-kick-500/20 text-kick-500'
          : 'border-border-strong bg-surface-2 text-text-secondary hover:text-text-body'
      }`}
    >
      {label} <span class="font-normal opacity-70">{count}</span>
    </button>
  )
  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center gap-1 border-b border-border px-3 py-2">
        {button('scheduled', 'Scheduled', store.cron().length)}
        {button('queues', 'Queues', store.queues().queues.length)}
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <Show when={view() === 'scheduled'} fallback={<QueuesTab />}>
          <CronPanel />
        </Show>
      </div>
    </div>
  )
}

/** "in 42s", "in 3m", "in 2h" — or "now" once it's due. */
function until(at: number, now: number): string {
  const s = Math.round((at - now) / 1000)
  return s <= 0 ? 'now' : `in ${formatUptime(s).split(' ')[0]}`
}

const CronPanel: Component = () => {
  const [now, setNow] = createSignal(Date.now())
  const [note, setNote] = createSignal<string | null>(null)
  const [armed, setArmed] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [filter, setFilter] = createSignal('')
  /** Jobs whose name, class, handler, description or schedule contains the filter. */
  const shown = createMemo(() => {
    const needle = filter().trim().toLowerCase()
    if (!needle) return store.cron()
    return store
      .cron()
      .filter((job) =>
        [job.name, job.className, job.handler, job.description, job.expression].some((v) =>
          v?.toLowerCase().includes(needle),
        ),
      )
  })
  // <Index> keeps rows by position: when the filter or a reload changes which
  // job sits in a row, an armed Run now could end up on another job's button.
  // Disarm whenever the visible jobs change; a refresh of the same jobs keeps it.
  // A memo, so the effect sees a change only when the names do: `on` alone
  // fires on every refresh, which brings new objects for the same jobs.
  const visibleNames = createMemo(() =>
    shown()
      .map((job) => job.name)
      .join('\n'),
  )
  createEffect(on(visibleNames, () => setArmed(null), { defer: true }))

  const refresh = async (): Promise<void> => {
    try {
      storeActions.setCron((await rpc.cron()).jobs)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setNow(Date.now())
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    onCleanup(() => clearInterval(timer))
  })

  // Running a job does real work (a sweep, a send) — the first click arms it.
  const runNow = async (job: CronJobEntry): Promise<void> => {
    if (armed() !== job.name) {
      setArmed(job.name)
      return
    }
    setArmed(null)
    try {
      await rpc.cronRun(job.name)
      setNote(`Started ${job.name}`)
      void refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <p class="mb-2 text-xs text-text-muted">
        Every <code>@Cron</code> job, whatever schedules it. Runs are counted from when the app
        started; <strong>Run now</strong> starts one immediately (it does the job's real work — the
        button asks twice).
      </p>
      <Show when={error()}>
        <div class="mb-2 text-sm text-red-500">{error()}</div>
      </Show>
      <Show when={note()}>
        <div class="mb-2 text-xs text-text-muted" role="status">
          {note()}
        </div>
      </Show>
      <Show
        when={store.cron().length}
        fallback={
          <div class="empty">
            No <code>@Cron</code> jobs — decorate a service method with{' '}
            <code>@Cron('*/5 * * * *')</code> and register the service.
          </div>
        }
      >
        <div class="mb-2 flex items-center gap-2">
          <input
            type="search"
            class="w-full max-w-sm rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text-body placeholder:text-text-muted"
            placeholder="Filter by name, handler, description or schedule"
            aria-label="Filter scheduled jobs"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <Show when={filter().trim()}>
            <span class="text-xs text-text-muted tabular-nums">
              {shown().length} of {store.cron().length}
            </span>
          </Show>
        </div>
        <Show when={shown().length === 0}>
          <div class="empty">No scheduled job matches “{filter().trim()}”</div>
        </Show>
        <table class="w-full border-collapse text-[0.78rem]">
          <thead>
            <tr class="text-left text-[0.66rem] uppercase tracking-wider text-text-muted">
              <th class="py-1.5 pr-3 font-semibold">Job</th>
              <th class="py-1.5 pr-3 font-semibold">Schedule</th>
              <th class="py-1.5 pr-3 font-semibold">Next</th>
              <th class="py-1.5 pr-3 font-semibold">Last run</th>
              <th class="py-1.5 pr-3 text-right font-semibold">Runs</th>
              <th class="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {/* <Index>: a refresh brings new objects; rows update in place, so an armed Run now keeps focus. */}
            <Index each={shown()}>
              {(job) => (
                <tr
                  class={`border-t border-border/60 align-top ${job().enabled ? '' : 'opacity-60'}`}
                >
                  <td class="py-1.5 pr-3">
                    <div class="font-mono text-text-strong">{job().name}</div>
                    <Show when={job().description}>
                      <div class="text-xs text-text-muted">{job().description}</div>
                    </Show>
                    <Show when={!job().enabled}>
                      <span class="dt-tone dt-tone-gray">disabled</span>
                    </Show>
                  </td>
                  <td class="py-1.5 pr-3 font-mono whitespace-nowrap">
                    {job().expression}
                    <Show when={job().timezone}>
                      <div class="text-xs text-text-muted">{job().timezone}</div>
                    </Show>
                  </td>
                  <td class="py-1.5 pr-3 whitespace-nowrap text-text-secondary">
                    <Show when={job().nextRunAt} fallback={<span class="text-text-muted">—</span>}>
                      {(at) => (
                        <span title={new Date(at()).toLocaleString()}>{until(at(), now())}</span>
                      )}
                    </Show>
                  </td>
                  <td class="py-1.5 pr-3">
                    <Show
                      when={job().stats.running > 0}
                      fallback={
                        <Show
                          when={job().stats.lastStartedAt}
                          fallback={<span class="text-text-muted">not since start</span>}
                        >
                          {(at) => (
                            <span class="whitespace-nowrap">
                              <span
                                class={
                                  job().stats.lastOutcome === 'failed'
                                    ? 'text-red-500'
                                    : 'text-emerald-500'
                                }
                              >
                                {job().stats.lastOutcome === 'failed' ? '✕ failed' : '✓ ok'}
                              </span>{' '}
                              <span class="text-text-muted">
                                {ago(at(), now())}
                                <Show when={job().stats.lastDurationMs !== undefined}>
                                  {' · '}
                                  {formatMs(job().stats.lastDurationMs!)}
                                </Show>
                              </span>
                            </span>
                          )}
                        </Show>
                      }
                    >
                      <span class="text-blue-500">running…</span>
                    </Show>
                    <Show when={job().stats.lastOutcome === 'failed' && job().stats.lastError}>
                      <div
                        class="max-w-md truncate text-xs text-red-500"
                        title={job().stats.lastError}
                      >
                        {job().stats.lastError}
                      </div>
                    </Show>
                  </td>
                  <td class="py-1.5 pr-3 text-right tabular-nums">
                    {job().stats.runs}
                    <Show when={job().stats.failures}>
                      <span class="text-red-500"> · {job().stats.failures} failed</span>
                    </Show>
                  </td>
                  <td class="py-1.5 text-right">
                    <button
                      type="button"
                      disabled={!job().enabled || (job().stats.running > 0 && !job().overlap)}
                      onClick={() => void runNow(job())}
                      onBlur={() => armed() === job().name && setArmed(null)}
                      class={`whitespace-nowrap rounded-md border px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                        armed() === job().name
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                          : 'border-border-strong bg-surface-2 text-text-secondary hover:text-text-strong'
                      }`}
                    >
                      {armed() === job().name ? 'Run it?' : 'Run now'}
                    </button>
                  </td>
                </tr>
              )}
            </Index>
          </tbody>
        </table>
      </Show>
    </div>
  )
}
