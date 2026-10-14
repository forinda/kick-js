---
'@forinda/kickjs': minor
---

Startup checks. Once the app is assembled, and before it serves a request, it runs checks that report findings with stable IDs. Warnings are logged, and errors fail startup with every error and its fix listed. Two built-in checks run in production: `KICK-SEC-W001` (no `security.allowedHosts`) and `KICK-SEC-W002` (`trustProxy: true`). Add your own with `defineCheck` and `bootstrap({ checks })`, and skip a finding you've accepted with `silenceChecks: ['ID']`.
