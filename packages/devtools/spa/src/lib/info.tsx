/**
 * Beginner-friendly info affordances — tooltip + modal pair.
 *
 * Most metric labels in the dashboard (heap, RSS, p99, error rate,
 * resolve count, etc.) are jargon that domain experts read at a
 * glance and beginners stare at blankly. This module provides:
 *
 *   <InfoTip text="..." />   — small ⓘ icon with a CSS hover tooltip,
 *                              good for one-line definitions.
 *   <InfoButton title="..." />
 *                            — clickable ⓘ that opens an InfoModal,
 *                              good for multi-paragraph explanations
 *                              with examples / formulae / external
 *                              links.
 *
 * Plus a shared {@link METRIC_DEFS} registry so each tab can lookup
 * the canonical explanation by key without duplicating prose. Adding
 * a new metric tooltip = one entry in METRIC_DEFS and one
 * `<InfoTip metric="..." />` at the call site.
 */

import { createSignal, JSX, Show, type Component } from 'solid-js'

export interface MetricDefinition {
  /** Single-line definition shown in the hover tooltip + modal title. */
  short: string
  /** Optional multi-line explanation shown only in the modal body. */
  detail?: string
}

/**
 * Canonical per-metric explanations. Tabs reference entries by key
 * via `<InfoTip metric="..." />` so wording stays consistent across
 * the dashboard and we have one place to revise.
 */
export const METRIC_DEFS: Record<string, MetricDefinition> = {
  // Memory
  'heap.used': {
    short: 'V8-allocated memory currently used by JavaScript objects.',
    detail:
      'Grows as your code allocates objects, shrinks after GC frees them. ' +
      'A consistently rising heap-used line on the sparkline is the textbook leak signature.',
  },
  'heap.total': {
    short: 'V8-allocated memory the JS heap is currently sized to use.',
    detail:
      'Larger than heap-used; V8 reserves headroom so allocations don\'t pause to grow the heap. ' +
      'Bumps up in 1-8 MiB jumps as the heap expands.',
  },
  rss: {
    short: 'Total memory resident in physical RAM for this Node process.',
    detail:
      'Includes the JS heap, native buffers, V8 internal structures, and code. ' +
      'Always larger than heap-used; the gap is "everything the OS sees" minus "JS objects".',
  },
  external: {
    short: 'Memory used by C++ objects bound to JS (Buffers, native bindings).',
  },
  'array-buffers': {
    short: 'Memory used by ArrayBuffer / SharedArrayBuffer instances.',
  },
  // Event loop / GC
  'event-loop.p99': {
    short: '99% of event-loop ticks completed within this time.',
    detail:
      'Sustained values above ~50ms mean some synchronous operation is blocking the loop. ' +
      'Common culprits: large JSON.parse, sync crypto, blocking DB drivers.',
  },
  gc: {
    short: 'Garbage-collector activity since process start.',
    detail:
      'Total run count and cumulative pause time. Frequent GC with low reclaim ratio = leak; ' +
      'rare GC with healthy reclaim = good citizen.',
  },
  // Memory health
  'leak.risk': {
    short: 'Heap-growth slope over the recent window — stable / warn / critical.',
    detail:
      'Bucketed from heap-growth in MB/min: <5 = ok, <20 = warn, ≥20 = critical. ' +
      'Critical sustained for >5 minutes is the moment to capture a heap snapshot.',
  },
  'gc.reclaim': {
    short: 'Average ratio of memory freed by each GC pass.',
    detail:
      'Trending toward zero means GC can\'t free anything — strong leak indicator. ' +
      'Healthy apps reclaim 20-60% on each major GC.',
  },
  'heap.utilization': {
    short: 'Fraction of V8\'s hard heap-size limit currently in use.',
    detail:
      'Approaching 1 means the process is close to OOM. ' +
      'Use --max-old-space-size to raise the limit if your workload is memory-bound.',
  },
  // HTTP metrics
  requests: { short: 'Total HTTP requests handled since process start.' },
  'server-errors': { short: '5xx responses — server-side failures.' },
  'client-errors': { short: '4xx responses — bad client input, missing routes, auth denials.' },
  'error-rate': {
    short: 'Server errors as a percentage of total requests.',
    detail:
      'Computed across the lifetime of the process. ' +
      'Spikes typically signal upstream dependency failures; sustained elevation = code bug.',
  },
  uptime: { short: 'How long this Node process has been running.' },
  // Routes / latency
  'latency.avg': { short: 'Mean response time per route (sum of all calls / call count).' },
  'latency.p50': { short: 'Median — half the requests complete faster than this.' },
  'latency.p95': { short: '95% of requests complete within this time.' },
  'latency.p99': { short: '99% of requests complete within this time. Outlier-sensitive.' },
  'latency.max': { short: 'Slowest single response observed since process start.' },
  // Container
  'resolve.count': { short: 'Number of times this token was resolved from the DI container.' },
  'resolve.duration': { short: 'How long the container took to resolve this token (ms).' },
  'post-construct': {
    short: '@PostConstruct lifecycle status: done / failed / none.',
    detail:
      'A failed PostConstruct means the service registered but its async init threw. ' +
      'The token is left in a "registered" state; resolve() will throw the original error.',
  },
}

/**
 * Inline ⓘ icon with a CSS hover tooltip. Use for one-line tooltips
 * next to metric labels. Pass either `text` directly or `metric` to
 * lookup METRIC_DEFS[key].short.
 */
export const InfoTip: Component<{
  text?: string
  metric?: keyof typeof METRIC_DEFS
  /** Override default top placement (e.g. 'bottom' for items near the page top). */
  placement?: 'top' | 'bottom'
}> = (props) => {
  const text = (): string => props.text ?? METRIC_DEFS[props.metric ?? '']?.short ?? ''
  const placement = props.placement ?? 'top'
  return (
    <span class="dt-tip" tabindex="0" aria-label={text()}>
      <svg class="dt-tip-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" />
        <path
          d="M12 8h.01M12 11v6"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          fill="none"
        />
      </svg>
      <span class={`dt-tip-pop dt-tip-pop-${placement}`} role="tooltip">
        {text()}
      </span>
    </span>
  )
}

/**
 * Click-to-open info modal. Use for metric clusters that benefit
 * from multi-paragraph explanations (Memory leak risk panel, GC
 * detail, etc.). Renders the same ⓘ icon as {@link InfoTip}.
 */
export const InfoButton: Component<{
  title: string
  /** Modal body — accepts JSX so callers can mix prose, code, links. */
  children: JSX.Element
}> = (props) => {
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button
        type="button"
        class="dt-tip dt-tip-clickable"
        aria-label={`More info: ${props.title}`}
        onClick={() => setOpen(true)}
      >
        <svg class="dt-tip-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M12 8h.01M12 11v6"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            fill="none"
          />
        </svg>
      </button>
      <Show when={open()}>
        <InfoModal title={props.title} onClose={() => setOpen(false)}>
          {props.children}
        </InfoModal>
      </Show>
    </>
  )
}

/**
 * Modal shell for the info content. Click-outside + Escape close.
 * Re-usable beyond InfoButton (DetailModal in commit 12 will wrap it).
 */
export const InfoModal: Component<{
  title: string
  onClose: () => void
  children: JSX.Element
}> = (props) => {
  return (
    <div
      class="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between mb-4">
          <h2 class="text-lg font-semibold text-slate-200">{props.title}</h2>
          <button
            type="button"
            class="text-slate-500 hover:text-slate-300 p-1"
            aria-label="Close"
            onClick={() => props.onClose()}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div class="text-sm text-slate-300 space-y-3">{props.children}</div>
      </div>
    </div>
  )
}
