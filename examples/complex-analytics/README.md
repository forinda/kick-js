# Complex analytics example

Simulates a small "reactive database" for analytics events. The `ReactiveAnalyticsDatabase` keeps a capped event log, maintains aggregations, and exposes metrics without additional queries.

Endpoints exposed by `EventController`:

- `POST /api/analytics/events` – record an event (`{ type, payload? }`).
- `GET /api/analytics/events` – list events with optional `type`/`since` filters.
- `GET /api/analytics/metrics` – current totals and counts per type.

Key files:

- `src/db/reactive-db.ts` – reactive event store with capped history and derived aggregations.
- `src/services/event.service.ts` – façade wrapping DB behavior for controllers.
- `src/controllers/event.controller.ts` – HTTP interface, schema validation, and telemetry logging.
- `index.ts` – binds the reactive DB and service into the container before bootstrap.

Because the underlying state is reactive, aggregations update automatically whenever events are recorded, and the registry history can drive devtools visualisations.
