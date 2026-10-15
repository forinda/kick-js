---
'@forinda/kickjs': minor
---

`<KEY>_FILE` secrets. For any key the env schema declares, setting `<KEY>_FILE=/run/secrets/…` reads that key's value from the file, following the Docker and Kubernetes convention, with one trailing newline dropped. The value reaches the parsed env (`getEnv`, `ConfigService`, `@Value`) but is not copied into `process.env`, which child processes inherit. Setting both `KEY` and `KEY_FILE`, or pointing at a file that can't be read, fails startup without printing the file's contents.
