/**
 * Agent skills as text files in scaffold layers: `templates/<layer>/skills/<slug>.txt`,
 * a frontmatter block (`name`, `description`) and the body. Plain text, so no
 * formatter touches them; `{{pm}}`, `{{kick}}`, `{{test}}` and `{{moduleEntry}}`
 * are filled when they're written out as `.agents/skills/<slug>/SKILL.md`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { execBin, runScript, type PackageManager } from '../config'
import type { ModuleStyle } from '../generators/templates/types'
import { fillVars, TEMPLATES_DIR } from './overlay'

export interface SkillVars {
  pm: string
  kick: string
  test: string
  moduleEntry: string
}

export interface LayerSkill {
  slug: string
  name: string
  description: string
  body: string
}

/** The values a skill's placeholders take for this package manager and module style. */
export function skillVars(pm: string, style: ModuleStyle): SkillVars {
  return {
    pm,
    kick: execBin(pm as PackageManager, 'kick'),
    test: runScript(pm as PackageManager, 'test'),
    // A class module is passed bare; a define module is invoked.
    moduleEntry: style === 'class' ? 'UserModule' : 'UserModule()',
  }
}

/** Every skill the `layers` carry, in layer order, each layer's by slug. */
export function readLayerSkills(
  layers: readonly string[],
  vars: SkillVars,
  dir = TEMPLATES_DIR,
): LayerSkill[] {
  const out: LayerSkill[] = []
  for (const layer of layers) {
    const folder = join(dir, layer, 'skills')
    if (!existsSync(folder)) continue
    for (const file of readdirSync(folder)
      .filter((f) => f.endsWith('.txt'))
      .toSorted()) {
      const text = readFileSync(join(folder, file), 'utf8')
      const m = /^---\nname: (.*)\ndescription: (.*)\n---\n\n([\s\S]*)$/.exec(text)
      if (!m) throw new Error(`${layer}/skills/${file}: expected a name / description frontmatter`)
      // A text file ends with a newline; SKILL.md adds its own.
      const filled = fillVars(new Map([['body', m[3]!.replace(/\n$/, '')]]), { ...vars })
      out.push({
        slug: file.slice(0, -'.txt'.length),
        name: m[1]!,
        description: m[2]!,
        body: filled.get('body')!,
      })
    }
  }
  return out
}

/**
 * The feature layers an app uses: each `feature-*` layer whose `feature.json`
 * lists dependencies that are all in `package.json` (dependencies or
 * devDependencies). A layer that lists none (devtools) never counts.
 */
export function detectFeatureLayers(appDir: string, dir = TEMPLATES_DIR): string[] {
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try {
    pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  } catch {
    return []
  }
  const installed = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
  return readdirSync(dir)
    .filter((layer) => layer.startsWith('feature-'))
    .toSorted()
    .filter((layer) => {
      const file = join(dir, layer, 'feature.json')
      if (!existsSync(file)) return false
      const deps = (JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: string[] })
        .dependencies
      return !!deps?.length && deps.every((d) => installed.has(d))
    })
}
