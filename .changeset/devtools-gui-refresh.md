---
'@forinda/kickjs-devtools': minor
---

A denser dashboard layout.

- **Icon sidebar:** the sidebar is a column of icons with tooltips and count badges. It can be expanded to labels, and the choice is remembered.
- **Routes:** a list grouped by controller, searchable and filterable by method, with the API runner open beside it. The divider can be resized, and its width is remembered. This replaces the paginated table and the overlay sheet.
- **Runner:** the method, resolved URL and **Send** sit in one bar at the top. Response and history statuses are colored pills.
- **Disconnect banner:** when the app stops answering, a banner says so and the dashboard keeps retrying. Before, it quietly stayed on "Polling" with stale data.
