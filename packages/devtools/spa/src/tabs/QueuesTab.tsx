/**
 * Queues — browse and manage background jobs through whatever runs them.
 * Pick a queue, then a state (each with its count); the jobs list beside the
 * selected job's data, result, error and attempts. The list is paged; the
 * filter matches id, name or error, scanning the state on the server a
 * thousand jobs at a time, and `#id` opens a job directly. Retry, remove, retry all
 * failed, clean a state, and pause / resume are offered when the job tool
 * supports them.
 *
 * Reads `/_debug/jobs*`, served from any adapter's or plugin's
 * `jobInspector()` — `QueueAdapter` provides one for BullMQ.
 */

import { createMemo, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js'
import type { JobDetail, JobState, JobSummary } from '@forinda/kickjs-devtools-kit'
import { rpc, type JobSource } from '../lib/rpc'
import { ago, formatMs } from '../lib/format'
import { SplitPane } from '../lib/split-pane'

const STATES: JobState[] = ['failed', 'active', 'waiting', 'delayed', 'completed', 'paused']
const PAGE = 50
/** How many jobs the server looks at per filtered request (its MAX_SCAN). */
const SCAN = 1000

const stateTone: Record<JobState, string> = {
  failed: 'text-red-500',
  active: 'text-blue-500',
  waiting: 'text-text-secondary',
  delayed: 'text-amber-500',
  completed: 'text-emerald-500',
  paused: 'text-text-muted',
}

export const QueuesTab: Component = () => {
  const [sources, setSources] = createSignal<JobSource[] | null>(null)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [pick, setPick] = createSignal<{ source: string; queue: string } | null>(null)
  const [state, setState] = createSignal<JobState>('failed')
  const [jobs, setJobs] = createSignal<JobSummary[]>([])
  const [listError, setListError] = createSignal<string | null>(null)
  /** Unfiltered: which page of the state. */
  const [page, setPage] = createSignal(0)
  /** What's typed in the filter box, and the filter in force (debounced). */
  const [filterText, setFilterText] = createSignal('')
  const [query, setQuery] = createSignal('')
  /** Filtered: where this scan starts, the starts of earlier pages, and how it went. */
  const [cursor, setCursor] = createSignal(0)
  const [back, setBack] = createSignal<number[]>([])
  const [scan, setScan] = createSignal<{ next: number | null; scanned: number } | null>(null)
  const [selected, setSelected] = createSignal<string | null>(null)
  const [detail, setDetail] = createSignal<JobDetail | null>(null)
  const [note, setNote] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  /** A destructive action waiting for its second click. */
  const [armed, setArmed] = createSignal<string | null>(null)

  const source = createMemo(() => sources()?.find((s) => s.source === pick()?.source))
  const queue = createMemo(() => source()?.queues.find((q) => q.name === pick()?.queue))
  const can = (a: JobSource['actions'][number]): boolean => !!source()?.actions.includes(a)
  /** Jobs in the state, when the job tool reports it. */
  const total = createMemo(() => queue()?.counts[state()])
  const lastPage = createMemo(() => {
    const t = total()
    return t === undefined ? undefined : Math.max(0, Math.ceil(t / PAGE) - 1)
  })

  const loadSources = async (): Promise<void> => {
    try {
      const { sources: list } = await rpc.jobs()
      setSources(list)
      setLoadError(null)
      if (!pick()) {
        const first = list.find((s) => s.queues.length)
        if (first) setPick({ source: first.source, queue: first.queues[0]!.name })
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }
  const loadJobs = async (): Promise<void> => {
    const p = pick()
    if (!p) return
    const q = query()
    // The state shrank under the page we were on (jobs retried, cleaned, finished).
    const last = lastPage()
    if (!q && last !== undefined && page() > last) setPage(last)
    const start = q ? cursor() : page() * PAGE
    try {
      const r = await rpc.jobList({
        ...p,
        state: state(),
        start,
        end: start + PAGE - 1,
        ...(q ? { q } : {}),
      })
      setJobs(r.jobs)
      setScan(q ? { next: r.next ?? null, scanned: r.scanned ?? 0 } : null)
      setListError(null)
    } catch (err) {
      setJobs([])
      setListError(err instanceof Error ? err.message : String(err))
    }
  }
  const loadDetail = async (): Promise<void> => {
    const p = pick()
    const id = selected()
    if (!p || !id) {
      setDetail(null)
      return
    }
    try {
      setDetail(await rpc.job({ ...p, id }))
    } catch {
      setDetail(null) // removed or moved on
    }
  }
  const refresh = async (): Promise<void> => {
    await loadSources()
    // A filtered list is a scan of up to a thousand jobs: it reloads when the
    // filter or page changes, not on every tick.
    await Promise.all([query() ? Promise.resolve() : loadJobs(), loadDetail()])
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    onCleanup(() => clearInterval(timer))
  })

  const choose = (next: { source: string; queue: string } | null, nextState = state()): void => {
    setPick(next)
    setState(nextState)
    resetPaging()
    setSelected(null)
    setDetail(null)
    void loadJobs()
  }
  function resetPaging(): void {
    setPage(0)
    setCursor(0)
    setBack([])
    setScan(null)
  }
  let debounce: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(debounce))
  const applyFilter = (text: string): void => {
    clearTimeout(debounce)
    setQuery(text.trim())
    resetPaging()
    void loadJobs()
  }
  const onFilterInput = (text: string): void => {
    setFilterText(text)
    clearTimeout(debounce)
    if (text.trim().startsWith('#')) return // a job id: Enter opens it
    debounce = setTimeout(() => applyFilter(text), 300)
  }
  const onFilterKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return
    const text = filterText().trim()
    if (text.startsWith('#') && text.length > 1) open(text.slice(1))
    else applyFilter(text)
  }
  const goPage = (n: number): void => {
    setPage(n)
    void loadJobs()
  }
  /** Filtered: carry on from where the last scan stopped. */
  const scanOn = (): void => {
    const next = scan()?.next
    if (next == null) return
    setBack((b) => [...b, cursor()])
    setCursor(next)
    void loadJobs()
  }
  const scanBack = (): void => {
    const b = back()
    if (!b.length) return
    setCursor(b[b.length - 1]!)
    setBack(b.slice(0, -1))
    void loadJobs()
  }

  const open = (id: string): void => {
    setSelected(id)
    void loadDetail()
  }

  const act = async (
    action: JobSource['actions'][number],
    opts: { id?: string; state?: JobState; confirm?: boolean } = {},
  ): Promise<void> => {
    const p = pick()
    if (!p) return
    // Destructive actions take two clicks: the first arms the button.
    const key = `${action}:${opts.id ?? opts.state ?? ''}`
    if (opts.confirm && armed() !== key) {
      setArmed(key)
      return
    }
    setArmed(null)
    setBusy(true)
    setNote(null)
    try {
      const r = await rpc.jobAction({ ...p, action, id: opts.id, state: opts.state })
      setNote(
        action === 'clean'
          ? `Removed ${r.count ?? 0} ${opts.state} jobs`
          : action === 'remove'
            ? 'Job removed'
            : action === 'retry'
              ? 'Job queued to run again'
              : action === 'retryAll'
                ? 'Failed jobs queued to run again'
                : action === 'pause'
                  ? 'Queue paused'
                  : 'Queue resumed',
      )
      if (action === 'remove' || action === 'retry') setSelected(null)
      await refresh()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const button = (danger = false) =>
    `rounded-md border px-2 py-0.5 text-xs disabled:opacity-50 ${
      danger
        ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
        : 'border-border-strong bg-surface-2 text-text-secondary hover:text-text-strong'
    }`

  const left = (
    <>
      <div class="flex flex-col gap-2 border-b border-border p-2">
        {/* Queues */}
        <div class="flex flex-wrap gap-1">
          <For each={sources() ?? []}>
            {(s) => (
              <For each={s.queues}>
                {(q) => {
                  const active = () => pick()?.source === s.source && pick()?.queue === q.name
                  return (
                    <button
                      type="button"
                      onClick={() => choose({ source: s.source, queue: q.name }, 'failed')}
                      title={(sources()?.length ?? 0) > 1 ? s.source : undefined}
                      class={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                        active()
                          ? 'border-kick-500/30 bg-kick-500/20 text-kick-500'
                          : 'border-border-strong bg-surface-2 text-text-secondary hover:text-text-body'
                      }`}
                    >
                      {q.name}
                      <Show when={q.paused}>
                        <span class="font-normal text-text-muted">paused</span>
                      </Show>
                      <Show when={q.counts.failed}>
                        <span class="rounded bg-red-500/15 px-1 text-red-500">
                          {q.counts.failed}
                        </span>
                      </Show>
                    </button>
                  )
                }}
              </For>
            )}
          </For>
        </div>
        {/* States */}
        <Show when={queue()}>
          {(q) => (
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <For each={STATES}>
                {(s) => (
                  <button
                    type="button"
                    onClick={() => choose(pick(), s)}
                    class={`border-b-2 pb-0.5 ${
                      state() === s
                        ? 'border-kick-500 font-semibold text-text-strong'
                        : 'border-transparent text-text-muted hover:text-text-body'
                    }`}
                  >
                    {s}{' '}
                    <span class={`tabular-nums ${q().counts[s] ? stateTone[s] : ''}`}>
                      {q().counts[s] ?? '–'}
                    </span>
                  </button>
                )}
              </For>
            </div>
          )}
        </Show>
        {/* Queue actions */}
        <Show when={queue()}>
          <div class="flex flex-wrap items-center gap-1.5">
            <Show when={can('retryAll') && state() === 'failed' && queue()!.counts.failed}>
              <button
                type="button"
                class={button()}
                disabled={busy()}
                onClick={() => void act('retryAll')}
              >
                Retry all failed
              </button>
            </Show>
            <Show when={can('clean') && jobs().length > 0}>
              <button
                type="button"
                class={button(true)}
                disabled={busy()}
                onClick={() => void act('clean', { state: state(), confirm: true })}
                onBlur={() => setArmed(null)}
              >
                {armed() === `clean:${state()}`
                  ? `Confirm: delete all ${state()}`
                  : `Clean ${state()}`}
              </button>
            </Show>
            <Show when={can(queue()!.paused ? 'resume' : 'pause')}>
              <button
                type="button"
                class={button()}
                disabled={busy()}
                onClick={() => void act(queue()!.paused ? 'resume' : 'pause')}
              >
                {queue()!.paused ? 'Resume queue' : 'Pause queue'}
              </button>
            </Show>
            <Show when={note()}>
              <span class="text-xs text-text-muted">{note()}</span>
            </Show>
          </div>
        </Show>
        {/* Filter */}
        <Show when={queue()}>
          <input
            type="search"
            class="w-full rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-text-body placeholder:text-text-muted"
            placeholder={`Filter ${state()} jobs by id, name or error · #id opens a job`}
            aria-label="Filter jobs"
            value={filterText()}
            onInput={(e) => onFilterInput(e.currentTarget.value)}
            onKeyDown={onFilterKey}
          />
        </Show>
      </div>
      {/* Jobs */}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show when={listError()}>
          <div class="p-4 text-sm text-text-muted">{listError()}</div>
        </Show>
        <Show
          when={jobs().length > 0}
          fallback={
            <Show when={queue() && !listError()}>
              <div class="empty">
                {query() ? `No ${state()} jobs match “${query()}” here` : `No ${state()} jobs`}
              </div>
            </Show>
          }
        >
          <For each={jobs()}>
            {(j) => (
              <button
                type="button"
                class={`flex w-full cursor-pointer items-center gap-2 border-0 border-b border-border/50 px-2.5 py-1 text-left text-[0.76rem] text-text-body ${
                  selected() === j.id
                    ? 'bg-accent/12 shadow-[inset_2px_0_0_0_var(--color-accent)]'
                    : 'bg-transparent hover:bg-surface-hover'
                }`}
                onClick={() => open(j.id)}
              >
                <span class="w-16 shrink-0 truncate font-mono text-[0.68rem] text-text-muted">
                  #{j.id}
                </span>
                <span class="w-32 shrink-0 truncate font-mono font-semibold">{j.name}</span>
                <span class="min-w-0 flex-1 truncate text-[0.72rem] text-red-500">
                  {j.failedReason ?? ''}
                </span>
                <Show when={j.attempts > 1 || j.maxAttempts}>
                  <span
                    class="shrink-0 text-[0.68rem] text-text-muted tabular-nums"
                    title="attempts"
                  >
                    {j.attempts}
                    {j.maxAttempts ? `/${j.maxAttempts}` : ''}
                  </span>
                </Show>
                <span class="w-14 shrink-0 text-right text-[0.66rem] text-text-muted">
                  {(j.finishedAt ?? j.createdAt) ? ago((j.finishedAt ?? j.createdAt)!) : ''}
                </span>
              </button>
            )}
          </For>
        </Show>
      </div>
      {/* Pages */}
      <Show when={queue() && !listError()}>
        <div class="flex items-center gap-1.5 border-t border-border px-2 py-1 text-[0.7rem] text-text-muted">
          <Show
            when={query()}
            fallback={
              <>
                <span class="tabular-nums">
                  {jobs().length ? `${page() * PAGE + 1}–${page() * PAGE + jobs().length}` : '0'}
                  {total() !== undefined ? ` of ${total()}` : ''}
                </span>
                <span class="flex-1" />
                <button
                  type="button"
                  class={button()}
                  disabled={page() === 0}
                  onClick={() => goPage(0)}
                  aria-label="First page"
                >
                  «
                </button>
                <button
                  type="button"
                  class={button()}
                  disabled={page() === 0}
                  onClick={() => goPage(page() - 1)}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                <span class="tabular-nums">
                  page {page() + 1}
                  {lastPage() !== undefined ? ` of ${lastPage()! + 1}` : ''}
                </span>
                <button
                  type="button"
                  class={button()}
                  disabled={lastPage() !== undefined ? page() >= lastPage()! : jobs().length < PAGE}
                  onClick={() => goPage(page() + 1)}
                  aria-label="Next page"
                >
                  ›
                </button>
                <Show when={lastPage() !== undefined}>
                  <button
                    type="button"
                    class={button()}
                    disabled={page() >= lastPage()!}
                    onClick={() => goPage(lastPage()!)}
                    aria-label="Last page"
                  >
                    »
                  </button>
                </Show>
              </>
            }
          >
            <span class="tabular-nums">
              {jobs().length} {jobs().length === 1 ? 'match' : 'matches'} in {state()} jobs{' '}
              {cursor() + 1}–{cursor() + (scan()?.scanned ?? 0)}
              {scan()?.next === null ? ' · end of list' : ''}
            </span>
            <span class="flex-1" />
            <button
              type="button"
              class={button()}
              disabled={!back().length}
              onClick={scanBack}
              aria-label="Previous matches"
            >
              ‹
            </button>
            <button
              type="button"
              class={button()}
              disabled={scan()?.next == null}
              onClick={scanOn}
              aria-label="Next matches"
            >
              {jobs().length ? '›' : `Search the next ${SCAN}`}
            </button>
          </Show>
        </div>
      </Show>
    </>
  )

  const right = (
    <Show
      when={detail()}
      fallback={
        <div class="dt-panel-grid">
          <div class="card text-sm text-text-muted">
            {selected() ? 'Loading…' : 'Select a job to see its data and errors'}
          </div>
        </div>
      }
    >
      {(j) => (
        <section class="flex h-full flex-col gap-3 overflow-y-auto bg-surface-1 p-4 text-[0.8rem]">
          <header class="flex flex-wrap items-center gap-2">
            <h2 class="m-0 font-mono text-base text-text-strong">{j().name}</h2>
            <span class={`text-xs font-semibold ${stateTone[j().state]}`}>{j().state}</span>
            <span class="font-mono text-xs text-text-muted">#{j().id}</span>
            <span class="flex-1" />
            <Show when={can('retry') && j().state === 'failed'}>
              <button
                type="button"
                class={button()}
                disabled={busy()}
                onClick={() => void act('retry', { id: j().id })}
              >
                Retry
              </button>
            </Show>
            <Show when={can('remove')}>
              <button
                type="button"
                class={button(true)}
                disabled={busy()}
                onClick={() => void act('remove', { id: j().id, confirm: true })}
                onBlur={() => setArmed(null)}
              >
                {armed() === `remove:${j().id}` ? 'Confirm remove' : 'Remove'}
              </button>
            </Show>
          </header>
          <dl class="grid grid-cols-[7rem_1fr] gap-y-1 text-xs">
            <dt class="text-text-muted">Attempts</dt>
            <dd class="m-0 tabular-nums">
              {j().attempts}
              {j().maxAttempts ? ` of ${j().maxAttempts}` : ''}
            </dd>
            <Show when={j().createdAt}>
              <dt class="text-text-muted">Created</dt>
              <dd class="m-0">{new Date(j().createdAt!).toLocaleString()}</dd>
            </Show>
            <Show when={j().processedAt && j().finishedAt}>
              <dt class="text-text-muted">Ran for</dt>
              <dd class="m-0">{formatMs(j().finishedAt! - j().processedAt!)}</dd>
            </Show>
            <Show when={j().delayMs}>
              <dt class="text-text-muted">Delay</dt>
              <dd class="m-0">{formatMs(j().delayMs!)}</dd>
            </Show>
          </dl>
          <Show when={j().failedReason}>
            <div class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-500">
              {j().failedReason}
            </div>
          </Show>
          <Block title="Data">{json(j().data)}</Block>
          <Show when={j().result !== undefined && j().result !== null}>
            <Block title="Result">{json(j().result)}</Block>
          </Show>
          <Show when={j().stacktrace?.length}>
            <Block title={`Stack traces (${j().stacktrace!.length})`}>
              <For each={j().stacktrace!.toReversed()}>
                {(trace) => (
                  <pre class="m-0 mb-1.5 max-h-48 overflow-auto rounded-md border border-border bg-surface-2 p-2 font-mono text-[0.68rem]">
                    {trace}
                  </pre>
                )}
              </For>
            </Block>
          </Show>
        </section>
      )}
    </Show>
  )

  return (
    <Show
      when={sources() && sources()!.length > 0}
      fallback={
        <div class="dt-panel-grid">
          <div class="card max-w-lg text-sm text-text-secondary">
            <Show when={loadError()} fallback={sources() ? noJobTool : 'Loading…'}>
              {loadError()}
            </Show>
          </div>
        </div>
      }
    >
      <SplitPane storageKey="queues" left={left} right={right} defaultLeft={560} />
    </Show>
  )
}

const noJobTool = (
  <>
    <p class="m-0 mb-2 font-semibold text-text-strong">No job tool is connected</p>
    <p class="m-0">
      Add <code>QueueAdapter</code> from <code>@forinda/kickjs-queue</code> to browse BullMQ jobs
      here — retry failures, remove jobs, pause a queue. Any other job tool can show up too by
      exposing <code>jobInspector()</code> from its adapter.
    </p>
  </>
)

function json(value: unknown) {
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  return (
    <pre class="m-0 max-h-72 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs">
      {text}
    </pre>
  )
}

const Block: Component<{ title: string; children: unknown }> = (props) => (
  <div>
    <h3 class="mb-1.5 text-[0.66rem] font-semibold uppercase tracking-wider text-text-muted">
      {props.title}
    </h3>
    {props.children as Element}
  </div>
)
