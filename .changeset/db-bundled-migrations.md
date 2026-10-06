---
'@forinda/kickjs-db': minor
---

Run migrations with no migrations folder at run time: `migrationFiles(files, modules?)` takes the migration files bundled into the app (Vite's `import.meta.glob` with `?raw`), and goes wherever `migrationsDir` does — `kickDbAdapter()`, `migrateLatest()` and the rest. Review and hash checks work as for a folder; an array mixes bundled files and folders.
