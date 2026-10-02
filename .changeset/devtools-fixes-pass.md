---
'@forinda/kickjs-devtools-kit': patch
'@forinda/kickjs-devtools': patch
---

DevTools fixes.

- **No false leak alarm at boot:** memory health ignores the first 30 seconds of uptime and waits for 20 seconds of settled samples before judging heap growth. Until then it reports `sampling: true` with severity `ok`. Before, normal startup allocation read as "critical" within seconds.
- **Consistent DI counts:** `/_debug/container` leaves out the dev server's `__hmr__` shadow registrations, like the topology and graph endpoints already did.
- **Readable labels in light theme:** kind and status labels no longer use dark-only colours.
- **No stray horizontal scrollbar:** hidden metric tooltips near the right edge no longer widen the page.
