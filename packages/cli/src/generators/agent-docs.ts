import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { writeFileSafe } from '../utils/fs'
import { confirm } from '../utils/prompts'
import {
  generateClaude,
  generateAgents,
  generateKickJsSkillFiles,
  generateGemini,
  generateCopilot,
} from './templates/project-docs'
import { loadKickConfig } from '../config'

type ProjectTemplate = 'rest' | 'minimal'

/**
 * Subdirectory (relative to the project root) where every shared
 * agent-context file lands. CLAUDE.md is the only exception — it stays
 * at the project root because Claude Code auto-loads CLAUDE.md from
 * there. CLAUDE.md is generated as a thin pointer that tells Claude
 * to read `.agents/AGENTS.md` first.
 *
 * Existing root-level AGENTS.md / kickjs-skills.md files (from older
 * scaffolds before this restructure) are left untouched — the
 * generator emits the new layout alongside them and leaves migration
 * to the adopter.
 */
const AGENTS_DIR = '.agents'

export interface GenerateAgentDocsOptions {
  outDir: string
  /** Override project name (defaults to package.json `name`). */
  name?: string
  /** Override package manager (defaults to package.json `packageManager` field, then 'pnpm'). */
  pm?: string
  /** Override template (defaults to kick.config.ts `pattern`, then 'ddd'). */
  template?: ProjectTemplate
  /**
   * Which file(s) to (re)generate. All `.agents/`-bound files land in
   * the project's `.agents/` subdirectory; `claude` is the only file
   * that stays at the project root.
   *
   * - `agents`  → `.agents/AGENTS.md`
   * - `claude`  → `CLAUDE.md` (root; thin pointer to .agents/)
   * - `skills`  → `.agents/kickjs-skills.md`
   * - `gemini`  → `.agents/GEMINI.md`
   * - `copilot` → `.agents/COPILOT.md`
   * - `both`    → `.agents/AGENTS.md` + `CLAUDE.md` (legacy alias)
   * - `all`     → every file above
   */
  only?: 'agents' | 'claude' | 'skills' | 'gemini' | 'copilot' | 'both' | 'all'
  /** Skip the overwrite prompt. */
  force?: boolean
}

const VALID_TEMPLATES = new Set<ProjectTemplate>(['rest', 'minimal'])

function detectName(outDir: string, override?: string): string {
  if (override) return override
  try {
    const pkg = JSON.parse(readFileSync(join(outDir, 'package.json'), 'utf-8')) as { name?: string }
    if (pkg.name) return pkg.name.replace(/^@[^/]+\//, '')
  } catch {
    // No package.json — fall back to folder name
  }
  return outDir.split('/').findLast(Boolean) ?? 'app'
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
  return 'rest'
}

export async function generateAgentDocs(options: GenerateAgentDocsOptions): Promise<string[]> {
  const only = options.only ?? 'all'
  const name = detectName(options.outDir, options.name)
  const pm = detectPm(options.outDir, options.pm)
  const template = await detectTemplate(options.outDir, options.template)

  const wantsAgents = only === 'agents' || only === 'both' || only === 'all'
  const wantsClaude = only === 'claude' || only === 'both' || only === 'all'
  const wantsSkills = only === 'skills' || only === 'all'
  const wantsGemini = only === 'gemini' || only === 'all'
  const wantsCopilot = only === 'copilot' || only === 'all'

  // CLAUDE.md stays at the project root because Claude Code auto-loads
  // it from there. Every other shared-context file lands under
  // `.agents/` so the root stays uncluttered. `writeFileSafe` creates
  // parent directories automatically — no need to pre-mkdir.
  const targets: { file: string; render: () => string }[] = []
  if (wantsAgents) {
    targets.push({
      file: join(options.outDir, AGENTS_DIR, 'AGENTS.md'),
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
    // Per-skill SKILL.md under `.agents/skills/<slug>/` so agents that
    // auto-discover skills (Claude Code, Copilot CLI plugins, Gemini's
    // activate_skill) pick each up by its frontmatter without needing
    // a separate index file.
    for (const skill of generateKickJsSkillFiles(name, template, pm)) {
      targets.push({
        file: join(options.outDir, AGENTS_DIR, 'skills', skill.slug, 'SKILL.md'),
        render: () => skill.content,
      })
    }
  }
  if (wantsGemini) {
    targets.push({
      file: join(options.outDir, AGENTS_DIR, 'GEMINI.md'),
      render: () => generateGemini(name, template, pm),
    })
  }
  if (wantsCopilot) {
    targets.push({
      file: join(options.outDir, AGENTS_DIR, 'COPILOT.md'),
      render: () => generateCopilot(name, template, pm),
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
