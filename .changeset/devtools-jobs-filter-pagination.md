---
'@forinda/kickjs-devtools': minor
---

The Jobs tab handles large queues. Queued jobs are paged — 50 to a page, with first / previous / next / last and "1–50 of 12,340" — where "Load more" stopped at the first 100 jobs of a state. A filter matches id, name or failure reason: `/_debug/jobs/list?q=` scans the state on the server, a thousand jobs per request, and says how far it got so the tab can search further; `#id` opens a job directly. The Scheduled view filters by name, handler, description or schedule. A filtered queue list reloads when you page or change the filter instead of every few seconds.
