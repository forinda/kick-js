---
'@forinda/kickjs-inertia': patch
---

A server-rendered head that arrives as one string — Svelte's `<svelte:head>` — now replaces the adapter's copy of every tag it sets, not only the first, so the HTML no longer carries two titles or descriptions.
