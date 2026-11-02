/**
 * `INJECTION_TOKEN` is a `unique symbol`, so every copy of its declaration is a
 * different type. When a package's bundled types carry their own copy, its tokens
 * stop matching `container.resolve()` while still working at runtime.
 *
 * A package gets a copy by exporting `createToken<T>()` with an inferred type and
 * no `InjectionToken` import in that file. Write the type on the export.
 *
 * Runs after `turbo run test`, which has built every package by then.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PACKAGES = resolve(import.meta.dirname, '../packages')
const problems = []

for (const name of readdirSync(PACKAGES)) {
  if (name === 'di') continue
  const manifest = join(PACKAGES, name, 'package.json')
  if (!existsSync(manifest) || !JSON.parse(readFileSync(manifest, 'utf8')).scripts?.build) continue

  const dist = join(PACKAGES, name, 'dist')
  if (!existsSync(dist)) {
    problems.push(`${name}/dist is missing, so its types went unchecked`)
    continue
  }
  for (const file of readdirSync(dist, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.d.mts')) continue
    if (readFileSync(join(dist, file), 'utf8').includes('declare const INJECTION_TOKEN')) {
      problems.push(`${name}/dist/${file} declares its own INJECTION_TOKEN`)
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}
