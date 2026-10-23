---
'@forinda/kickjs': patch
---

`session()` with a store also saves before the response on h3 behind a fetch handler. Through fetch, h3 hands connect middleware a stand-in response that only fires `finish`, and the save there wasn't waited for. A redirect after a form post could still read the old session, losing flashed errors and Inertia's previous-page URL. That `finish` step now waits for a listener's promise, at most `saveTimeout`, before the response is handed back.
