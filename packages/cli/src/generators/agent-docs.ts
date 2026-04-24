import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { writeFileSafe } from '../utils/fs'
import { confirm } from '../utils/prompts'
import { generateClaude, generateAgents, generateKickJsSkills } from './templates/project-docs'
import { loadKickConfig } from '../config'

type ProjectTemplate = 'rest' | 'graphql' | 'ddd' | 'cqrs' | 'minimal'

export interface GenerateAgentDocsOptions {
  outDir: string
  /** Override project name (defaults to package.json `name`). */
  name?: string
  /** Override package manager (defaults to package.json `packageManager` field, then 'pnpm'). */
  pm?: string
  /** Override template (defaults to kick.config.ts `pattern`, then 'ddd'). */
  template?: ProjectTemplate
  /**
   * Which file(s) to (re)generate.
   * - `agents` → AGENTS.md only
   * - `claude` → CLAUDE.md only
   * - `skills` → kickjs-skills.md only
   * - `both`   → AGENTS.md + CLAUDE.md (legacy default)
   * - `all`    → AGENTS.md + CLAUDE.md + kickjs-skills.md
   */
  only?: 'agents' | 'claude' | 'skills' | 'both' | 'all'
  /** Skip the overwrite prompt. */
  force?: boolean
}

const VALID_TEMPLATES = new Set<ProjectTemplate>(['rest', 'graphql', 'ddd', 'cqrs', 'minimal'])

function detectName(outDir: string, override?: string): string {
  if (override) return override
  try {
    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf-8')) as { name?: string }
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '')
  } catch {
    // No package.json — fall back to folder name
  }
  return outDir.split('/').filter(Boolean).pop() ?? 'app'
}

function detectPm(outDir: string, override?: string): string {
  if (override) return override
  try {
    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf-8')) as {
      packageManager?: string
    }
    if (pkg.packageManager) return pkg.packageManager.split('@')[0]
  } catch {
    // ignore
  }
  return 'pnpm'
}

async function detectTemplate(
  outDir: string,
  override?: ProjectTemplate,
): Promise<ProjectTemplate> {
  if (override) return override
  try {
    const cfg = await loadKickConfig(outDir)
    const pattern = cfg?.pattern as ProjectTemplate | undefined
    if (pattern && VALID_TEMPLATES.has(pattern)) return pattern
  } catch {
    // ignore
  }
  return 'ddd'
}

export async function generateAgentDocs(options: GenerateAgentDocsOptions): Promise<string[]> {
  const only = options.only ?? 'all'
  const name = detectName(options.outDir, options.name)
  const pm = detectPm(options.outDir, options.pm)
  const template = await detectTemplate(options.outDir, options.template)

  const wantsAgents = only === 'agents' || only === 'both' || only === 'all'
  const wantsClaude = only === 'claude' || only === 'both' || only === 'all'
  const wantsSkills = only === 'skills' || only === 'all'

  const targets: { file: string; render: () => string }[] = []
  if (wantsAgents) {
    targets.push({
      file: join(options.outDir, 'AGENTS.md'),
      render: () => generateAgents(name, template, pm),
    })
  }
  if (wantsClaude) {
    targets.push({
      file: join(options.outDir, 'CLAUDE.md'),
      render: () => generateClaude(name, template, pm),
    })
  }
  if (wantsSkills) {
    targets.push({
      file: join(options.outDir, 'kickjs-skills.md'),
      render: () => generateKickJsSkills(name, template, pm),
    })
  }

  const written: string[] = []
  for (const { file, render } of targets) {
    if (existsSync(file) && !options.force) {
      const overwrite = await confirm({
        message: `${file.replace(options.outDir + '/', '')} already exists. Overwrite?`,
        initialValue: false,
      })
      if (!overwrite) {
        console.log(`  Skipped — existing ${file.replace(options.outDir + '/', '')} preserved.`)
        continue
      }
    }
    await writeFileSafe(file, render())
    written.push(file)
  }
  return written
}
