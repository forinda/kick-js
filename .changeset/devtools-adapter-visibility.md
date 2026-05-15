---
'@forinda/kickjs-devtools': patch
---

fix(devtools): surface every peer adapter on `/_debug/health` + Overview

Two related bugs caused the DevTools Overview > Health card to list
**only** `DevToolsAdapter` even when the app booted with several
adapters:

- `adapterStatuses` was only ever written in `beforeMount`/`shutdown`
  for the DevTools adapter itself — peers were never added, so the
  `/_debug/health` JSON returned `adapters: { DevToolsAdapter: 'running' }`
  regardless of how many other adapters were registered.
- The Overview > Health card's Adapters accordion defaulted to
  collapsed, hiding the list further.

The fix seeds `adapterStatuses` from `getPeerAdapters()` in `afterStart`
(every mounted peer appears as `running`), refreshes each entry from
`peer.onHealthCheck()` when present at request time so the status is
live rather than a frozen boot snapshot, and defaults the Overview
accordion to open. No public-API change.
