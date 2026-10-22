/**
 * Where each pipe in `pipes.ts` is declared and what it takes — for hover and
 * go to definition. Read lexically, like the engine's `readPipeExports`: only
 * `export const|let|var name = (…) =>` and `export function name(…)` forms.
 */
export interface PipeDeclaration {
  /** 0-based. */
  line: number
  column: number
  signature: string
}

const DECL =
  /^export\s+(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:\(([^)]*)\)|([A-Za-z_$][\w$]*)\s*=>)|function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\))/

export function pipeDeclarations(source: string): Map<string, PipeDeclaration> {
  const out = new Map<string, PipeDeclaration>()
  source.split('\n').forEach((text, line) => {
    const m = DECL.exec(text)
    if (!m) return
    const name = (m[1] ?? m[4])!
    const params = (m[2] ?? m[3] ?? m[5] ?? '').replace(/\s+/g, ' ').trim()
    out.set(name, { line, column: text.indexOf(name), signature: `${name}(${params})` })
  })
  return out
}
