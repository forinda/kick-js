#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import translate from '@vitalets/google-translate-api'

const DOCS_DIR = path.resolve(import.meta.dirname, '..', 'docs')

const LOCALES = [
  { code: 'fr', label: 'Français', lang: 'fr-FR' },
  { code: 'es', label: 'Español', lang: 'es-ES' },
  { code: 'de', label: 'Deutsch', lang: 'de-DE' },
  { code: 'zh', label: '中文', lang: 'zh-CN' },
  { code: 'ja', label: '日本語', lang: 'ja-JP' },
  { code: 'pt', label: 'Português', lang: 'pt-BR' },
  { code: 'ar', label: 'العربية', lang: 'ar-SA' },
]

/** Delay helper to avoid rate limiting */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Collect all markdown files from a directory recursively
 */
function getMarkdownFiles(dir, base = dir) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (
        LOCALES.some((l) => l.code === entry.name) ||
        ['versions', '.vitepress', 'node_modules'].includes(entry.name)
      ) {
        continue
      }
      results.push(...getMarkdownFiles(fullPath, base))
    } else if (entry.name.endsWith('.md')) {
      results.push(path.relative(base, fullPath))
    }
  }
  return results
}

/**
 * Translate a string, returns original on failure
 */
async function translateString(text, targetLang) {
  if (!text || !text.trim()) return text
  try {
    const result = await translate.translate(text, { to: targetLang })
    await delay(100)
    return result.text
  } catch {
    return text
  }
}

/**
 * Translate YAML frontmatter values (preserving keys and structure)
 */
async function translateFrontmatter(frontmatter, targetLang) {
  const lines = frontmatter.split('\n')
  const translated = []

  for (const line of lines) {
    // Skip delimiter lines
    if (line.trim() === '---') {
      translated.push(line)
      continue
    }

    // Skip empty lines
    if (!line.trim()) {
      translated.push(line)
      continue
    }

    // Match key: value pairs (but skip links, themes, layouts, boolean-like values)
    const kvMatch = line.match(/^(\s*-?\s*)(text|name|tagline|title|details|description|message|copyright):\s*(.+)$/)
    if (kvMatch) {
      const prefix = kvMatch[1]
      const key = kvMatch[2]
      let value = kvMatch[3]

      // Remove surrounding quotes if present
      const quoted = value.startsWith('"') && value.endsWith('"')
      if (quoted) value = value.slice(1, -1)

      const translatedValue = await translateString(value, targetLang)
      translated.push(`${prefix}${key}: ${quoted ? '"' : ''}${translatedValue}${quoted ? '"' : ''}`)
    } else {
      translated.push(line)
    }
  }

  return translated.join('\n')
}

/**
 * Translate markdown content (outside code blocks)
 */
async function translateMarkdown(content, targetLang) {
  // Separate frontmatter
  let frontmatter = ''
  let body = content

  if (content.startsWith('---\n')) {
    const endIdx = content.indexOf('\n---\n', 4)
    if (endIdx !== -1) {
      frontmatter = content.slice(0, endIdx + 5)
      body = content.slice(endIdx + 5)
    }
  }

  // Translate frontmatter
  if (frontmatter) {
    frontmatter = await translateFrontmatter(frontmatter, targetLang)
  }

  // Split body by code blocks
  const parts = []
  const codeBlockRegex = /(```[\s\S]*?```)/g
  let lastIndex = 0
  let match

  while ((match = codeBlockRegex.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: body.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'code', value: match[1] })
    lastIndex = match.index + match[1].length
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', value: body.slice(lastIndex) })
  }

  // Translate text parts line by line
  const translatedParts = []
  for (const part of parts) {
    if (part.type === 'code') {
      translatedParts.push(part.value)
      continue
    }

    const lines = part.value.split('\n')
    const translatedLines = []

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines, table separators, pure links
      if (!trimmed || /^[|:=-]+$/.test(trimmed)) {
        translatedLines.push(line)
        continue
      }

      // Translate heading: preserve ## prefix
      const headingMatch = line.match(/^(#{1,6}\s+)(.+)$/)
      if (headingMatch) {
        const translatedHeading = await translateString(headingMatch[2], targetLang)
        translatedLines.push(headingMatch[1] + translatedHeading)
        continue
      }

      // Translate list items: preserve - / * / 1. prefix
      const listMatch = line.match(/^(\s*[-*]\s+|\s*\d+\.\s+)(.+)$/)
      if (listMatch) {
        const translatedItem = await translateString(listMatch[2], targetLang)
        translatedLines.push(listMatch[1] + translatedItem)
        continue
      }

      // Translate table cells: preserve | structure
      const tableMatch = line.match(/^\|(.+)\|$/)
      if (tableMatch) {
        const cells = tableMatch[1].split('|')
        const translatedCells = []
        for (const cell of cells) {
          if (cell.trim() && !/^[-:=]+$/.test(cell.trim())) {
            translatedCells.push(' ' + (await translateString(cell.trim(), targetLang)) + ' ')
          } else {
            translatedCells.push(cell)
          }
        }
        translatedLines.push('|' + translatedCells.join('|') + '|')
        continue
      }

      // Translate blockquotes: preserve > prefix
      const quoteMatch = line.match(/^(\s*>\s*)(.+)$/)
      if (quoteMatch) {
        const translatedQuote = await translateString(quoteMatch[2], targetLang)
        translatedLines.push(quoteMatch[1] + translatedQuote)
        continue
      }

      // Regular paragraph text
      const leadingSpace = line.match(/^(\s*)/)?.[1] ?? ''
      const translatedLine = await translateString(trimmed, targetLang)
      translatedLines.push(leadingSpace + translatedLine)
    }

    translatedParts.push(translatedLines.join('\n'))
  }

  return frontmatter + translatedParts.join('')
}

async function main() {
  const targetLocales = process.argv.slice(2)
  const locales =
    targetLocales.length > 0
      ? LOCALES.filter((l) => targetLocales.includes(l.code))
      : LOCALES

  if (locales.length === 0) {
    console.error(`Unknown locale(s): ${targetLocales.join(', ')}`)
    console.error(`Available: ${LOCALES.map((l) => l.code).join(', ')}`)
    process.exit(1)
  }

  const mdFiles = getMarkdownFiles(DOCS_DIR)
  console.log(`Found ${mdFiles.length} markdown files to translate`)
  console.log(`Target languages: ${locales.map((l) => `${l.code} (${l.label})`).join(', ')}`)

  for (const locale of locales) {
    console.log(`\nTranslating to ${locale.label} (${locale.code})...`)
    const localeDir = path.join(DOCS_DIR, locale.code)

    for (let i = 0; i < mdFiles.length; i++) {
      const file = mdFiles[i]
      const srcPath = path.join(DOCS_DIR, file)
      const destPath = path.join(localeDir, file)

      // Skip if translation already exists and source hasn't changed
      if (fs.existsSync(destPath)) {
        const srcStat = fs.statSync(srcPath)
        const destStat = fs.statSync(destPath)
        if (destStat.mtimeMs > srcStat.mtimeMs) {
          console.log(`  [${i + 1}/${mdFiles.length}] Skipping ${file} (up to date)`)
          continue
        }
      }

      console.log(`  [${i + 1}/${mdFiles.length}] Translating ${file}...`)
      const content = fs.readFileSync(srcPath, 'utf-8')

      try {
        const translated = await translateMarkdown(content, locale.code)
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, translated)
      } catch (err) {
        console.error(`  Error translating ${file}: ${err}`)
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.copyFileSync(srcPath, destPath)
      }

      await delay(200)
    }
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
