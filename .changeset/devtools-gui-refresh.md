---
'@forinda/kickjs-devtools': minor
---

A denser dashboard layout.

- **Icon sidebar:** the sidebar is a column of icons with tooltips and count badges. It can be expanded to labels, and the choice is remembered.
- **Routes:** a list grouped by controller, searchable and filterable by method, with the API runner open beside it. The divider can be resized, and its width is remembered. This replaces the paginated table and the overlay sheet.
- **Runner:** the method, resolved URL and **Send** sit in one bar at the top. Response and history statuses are colored pills.
- **Disconnect banner:** when the app stops answering, a banner says so and the dashboard keeps retrying. Before, it quietly stayed on "Polling" with stale data.
- **Command palette:** ⌘K / Ctrl+K (or `/`) finds a tab, route or DI token and jumps to it, and switches theme or density.
- **Requests tab:** the app's recent requests (status, method, path, duration, and the error a failed one threw), filterable by status, with a detail pane and **Replay in runner**. Served from the new `GET /_debug/requests`; `requestLog` sets how many are kept (default 200).
- **Overview:** a strip of headline numbers (requests, server errors, p95 latency, heap) with last-minute sparklines, the latest failed requests with their errors, and app status with adapter status dots. Replaces the three cards.
- **Runtime:** the Memory tab is folded into Runtime — four charts (heap, process memory, event-loop delay with GC ticks, CPU) over the last minute, memory health, and the heap-snapshot / force-GC actions in the header.
- **Metrics:** a sortable per-route table with 5xx share, percentile bars and a latency histogram per route. `/_debug/metrics` adds `serverErrors`, `clientErrors` and `histogram` to each route, and `latencyBucketsMs`.
