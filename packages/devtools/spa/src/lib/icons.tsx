/**
 * Stroke icons for the sidebar and command palette — inline SVG paths, so
 * the bundle needs no icon font or library.
 */
import type { Component } from 'solid-js'

const PATHS: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  runtime: 'M22 12h-4l-3 9L9 3l-3 9H2',
  memory:
    'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  topology: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  metrics: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  routes:
    'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  requests: 'M7 7h13l-4-4M17 17H4l4 4',
  container: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  graph:
    'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  database:
    'M12 3c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 6v12c0 1.66 4 3 9 3s9-1.34 9-3V6',
  queues: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  activity: 'M12 8v4l3 3M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  custom: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6',
  expand: 'M9 18l6-6-6-6',
  collapse: 'M15 18l-6-6 6-6',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  action: 'M13 2L3 14h9l-1 8 10-12h-9z',
  editor: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.75-1.4',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  maximize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
}

export const Icon: Component<{ name: string; size?: number; class?: string }> = (props) => (
  <svg
    viewBox="0 0 24 24"
    width={props.size ?? 18}
    height={props.size ?? 18}
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={props.class}
    aria-hidden="true"
  >
    <path d={PATHS[props.name] ?? PATHS.custom} />
  </svg>
)
