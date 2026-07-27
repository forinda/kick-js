---
'@forinda/kickjs-cli': patch
---

fix: scaffolded projects no longer pin every `@forinda/kickjs*` dependency to the CLI's own version

`kick new` resolves each sibling package's published version with `npm view <pkg> version`, falling back to the CLI's version when the query fails. On Windows that query always failed: `npm` is a `.cmd` batch shim, so `execFileSync('npm', …)` raised `ENOENT` (there is no `npm.exe`) and `npm.cmd` raised `EINVAL` (Node >= 18.20 refuses to spawn batch files without a shell — CVE-2024-27980). The error was swallowed, so every generated `package.json` silently collapsed onto the CLI version — `@forinda/kickjs`, `-schema`, `-vite`, `-swagger` and friends all stamped `^<cli version>` even though per-package independent versioning means they diverge.

Version resolution now goes through a cross-platform `captureCommand` helper that routes `.cmd` shims via `cmd.exe` on Windows, so each dependency gets its real published range. The same helper fixes `kick new --template fullstack`, whose root `<pm> install` step failed on Windows for the same reason.
