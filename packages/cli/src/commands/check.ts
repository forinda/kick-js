import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { colors, severityColor } from '../utils/colors'
import { intro, outro, spinner as createSpinner, log } from '../utils/prompts'

/* ── Severity levels ──────────────────────────────────────────────── */

type Severity = 'CRITICAL' | 'WARNING' | 'INFO'

interface CheckResult {
  severity: Severity
  message: string
}

/* ── File scanner ─────────────────────────────────────────────────── */

/** Recursively collect all .ts files under a directory */
function collectTsFiles(dir: string): string[] {
  const files: string[] = []
  if (!existsSync(dir)) return files

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip node_modules, dist, .kickjs
      if (['node_modules', 'dist', '.kickjs', '.git'].includes(entry.name)) continue
      files.push(...collectTsFiles(fullPath))
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath)
    }
  }
  return files
}

/** Read a file safely, returning empty string on failure */
function safeRead(filepath: string): string {
  try {
    return readFileSync(filepath, 'utf-8')
  } catch {
    return ''
  }
}

/* ── Individual checks ────────────────────────────────────────────── */

const WEAK_SECRETS = new Set(['secret', 'changeme', 'password', 'test', 'default', ''])

function checkJwtSecret(cwd: string, sourceContents: string[]): CheckResult | null {
  // Check .env file
  const envPath = join(cwd, '.env')
  const envContent = safeRead(envPath)

  if (envContent) {
    const match = envContent.match(/^JWT_SECRET\s*=\s*['"]?([^'"\n]*)['"]?/m)
    if (match) {
      const value = match[1].trim()
      if (WEAK_SECRETS.has(value.toLowerCase()) || value.length < 32) {
        return {
          severity: 'CRITICAL',
          message: 'JWT_SECRET appears to be a default value or too short (< 32 chars) — change it',
        }
      }
    }
  }

  // Check source files for hardcoded weak secrets
  for (const content of sourceContents) {
    // Look for JWT_SECRET assignments with weak values
    const patterns = [
      /JWT_SECRET['"]?\s*[:=]\s*['"]?(secret|changeme|password|test|default)['"]?/i,
      /secret\s*[:=]\s*['"]?(secret|changeme|password|test|default)['"]?/i,
    ]
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        return {
          severity: 'CRITICAL',
          message:
            'JWT_SECRET appears to be a default value in source code — use an environment variable',
        }
      }
    }
  }

  return null
}

function checkCorsOrigin(sourceContents: string[]): CheckResult | null {
  for (const content of sourceContents) {
    // Match cors({ ... origin: '*' ... }) or cors({ origin: ['*'] })
    if (/cors\s*\(/.test(content) && /origin\s*:\s*['"]\*['"]/.test(content)) {
      return {
        severity: 'CRITICAL',
        message: "CORS origin is '*' — restrict to your domains",
      }
    }
  }
  return null
}

function checkRateLimiting(sourceContents: string[]): CheckResult | null {
  for (const content of sourceContents) {
    if (/rateLimit/i.test(content) || /@RateLimit/i.test(content)) {
      return null // Found rate limiting
    }
  }
  return {
    severity: 'WARNING',
    message: 'No rate limiting detected — add rateLimit() middleware or @RateLimit decorator',
  }
}

function checkNodeEnv(): CheckResult | null {
  if (process.env.NODE_ENV !== 'production') {
    return {
      severity: 'WARNING',
      message: `NODE_ENV is '${process.env.NODE_ENV ?? 'undefined'}', not 'production'`,
    }
  }
  return null
}

function checkTokenStore(sourceContents: string[]): CheckResult | null {
  let hasTokenStore = false
  let usesMemoryStore = false

  for (const content of sourceContents) {
    if (/tokenStore/i.test(content)) hasTokenStore = true
    if (/MemoryTokenStore/i.test(content)) usesMemoryStore = true
  }

  if (usesMemoryStore) {
    return {
      severity: 'WARNING',
      message:
        'MemoryTokenStore detected — use a persistent store (Redis, DB) for production deployments',
    }
  }
  if (!hasTokenStore) {
    return {
      severity: 'WARNING',
      message: 'No token revocation store detected — consider adding one for auth token management',
    }
  }
  return null
}

function checkHelmet(sourceContents: string[]): CheckResult {
  for (const content of sourceContents) {
    if (/helmet\s*\(/.test(content)) {
      // Check it's not disabled
      if (/security\s*\.\s*helmet\s*.*false/.test(content)) {
        return {
          severity: 'WARNING',
          message: 'Helmet security headers are disabled — enable them for production',
        }
      }
      return {
        severity: 'INFO',
        message: 'Helmet security headers active',
      }
    }
  }
  return {
    severity: 'WARNING',
    message: 'Helmet not detected — add helmet() middleware for security headers',
  }
}

function checkAuthAdapter(sourceContents: string[]): CheckResult {
  for (const content of sourceContents) {
    if (/AuthAdapter/i.test(content)) {
      return {
        severity: 'INFO',
        message: 'AuthAdapter configured',
      }
    }
  }
  return {
    severity: 'INFO',
    message: 'No AuthAdapter detected — add one if your app requires authentication',
  }
}

/* ── Main check runner ────────────────────────────────────────────── */

function runDeployChecks(cwd: string): CheckResult[] {
  const srcDir = join(cwd, 'src')
  const tsFiles = collectTsFiles(srcDir)
  const sourceContents = tsFiles.map((f) => safeRead(f))

  const results: CheckResult[] = []

  // CRITICAL checks
  const jwtResult = checkJwtSecret(cwd, sourceContents)
  if (jwtResult) results.push(jwtResult)

  const corsResult = checkCorsOrigin(sourceContents)
  if (corsResult) results.push(corsResult)

  // WARNING checks
  const rateLimitResult = checkRateLimiting(sourceContents)
  if (rateLimitResult) results.push(rateLimitResult)

  const nodeEnvResult = checkNodeEnv()
  if (nodeEnvResult) results.push(nodeEnvResult)

  const tokenStoreResult = checkTokenStore(sourceContents)
  if (tokenStoreResult) results.push(tokenStoreResult)

  // INFO checks
  results.push(checkHelmet(sourceContents))
  results.push(checkAuthAdapter(sourceContents))

  return results
}

/* ── Command registration ─────────────────────────────────────────── */

export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Audit project for common issues')
    .option('--deploy', 'Run production readiness checks')
    .action((opts: any) => {
      if (!opts.deploy) {
        console.log(
          '\n  Usage: kick check --deploy\n\n' +
            '  Available checks:\n' +
            '    --deploy    Audit for production readiness (security, config, best practices)\n',
        )
        return
      }

      const cwd = process.cwd()

      intro('KickJS Deploy Check')

      const s = createSpinner()
      s.start('Scanning project...')
      const results = runDeployChecks(cwd)
      s.stop('Scan complete')

      // Sort: CRITICAL first, then WARNING, then INFO
      const order: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 }
      results.sort((a, b) => order[a.severity] - order[b.severity])

      for (const r of results) {
        log.message(`${severityColor(r.severity)} ${r.message}`)
      }

      const critical = results.filter((r) => r.severity === 'CRITICAL').length
      const warnings = results.filter((r) => r.severity === 'WARNING').length
      const info = results.filter((r) => r.severity === 'INFO').length

      const warnLabel = warnings === 1 ? 'warning' : 'warnings'
      const criticalText =
        critical > 0 ? colors.red(`${critical} critical`) : `${critical} critical`
      const warningText =
        warnings > 0 ? colors.yellow(`${warnings} ${warnLabel}`) : `${warnings} ${warnLabel}`
      const summary = [criticalText, warningText, `${info} info`].join(', ')

      if (critical > 0) {
        outro(colors.red(`${summary} — fix critical issues before deploying`))
        process.exit(1)
      } else {
        outro(colors.green(`${summary} — looking good!`))
      }
    })
}
