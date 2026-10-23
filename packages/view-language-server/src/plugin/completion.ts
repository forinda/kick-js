/**
 * Completions the HTML service can't give: control-flow keywords, pipes,
 * components and their inputs, template and slot names, and the names in
 * scope inside an expression. Everything else is left to the HTML service.
 */
import type { CompletionItem } from '@volar/language-service'
import { cursorContext } from '../context'
import type { Workspace } from '../workspace'

const SNIPPET = 2 as const
const KEYWORD = 14 as const
const FUNCTION = 3 as const
const CLASS = 7 as const
const PROPERTY = 10 as const
const FILE = 17 as const
const VARIABLE = 6 as const

/** Request-wide names every template has (see `@forinda/kickjs-view`'s form state). */
const FORM_STATE = ['$errors', '$old', '$flash']

const KEYWORDS: Record<string, string> = {
  if: 'if (${1:condition}) {\n\t$0\n}',
  'else if': 'else if (${1:condition}) {\n\t$0\n}',
  else: 'else {\n\t$0\n}',
  for: 'for (${1:item} of ${2:items}) {\n\t$0\n}',
  empty: 'empty {\n\t$0\n}',
  switch: 'switch (${1:value}) {\n\t@case (${2:match}) {\n\t\t$0\n\t}\n}',
  case: 'case (${1:match}) {\n\t$0\n}',
  default: 'default {\n\t$0\n}',
  let: 'let ${1:name} = $2;',
  input: 'input ${1:name}',
  layout: "layout('$1')",
  slot: "slot('${1:name}') {\n\t$0\n}",
  error: "error('${1:field}') {\n\t$0\n}",
  assets: "assets('$1')",
  verbatim: 'verbatim {\n\t$0\n}',
}

/** The template a component tag names, if any. */
export function componentOf(ws: Workspace, tag: string): string | undefined {
  const dir = ws.componentsDir()
  return ws.names().find((n) => n.startsWith(`${dir}/`) && ws.view.componentTag(n, dir) === tag)
}

/** Slot names the layouts above `name` declare, nearest first. */
function layoutSlots(ws: Workspace, name: string | undefined): string[] {
  const out = new Set<string>()
  const seen = new Set<string>()
  const chain: string[] = []
  let layout = name === undefined ? undefined : ws.layoutOf(name)
  while (layout !== undefined && !seen.has(layout)) {
    seen.add(layout)
    chain.push(layout)
    layout = ws.layoutOf(layout)
  }
  // The base layout wraps the chain, so its slots are fillable too.
  const base = ws.baseLayout()
  const page = name === undefined ? undefined : ws.astOf(name)
  if (
    base !== undefined &&
    name !== undefined &&
    page?.layout !== null &&
    !name.startsWith(`${ws.componentsDir()}/`) &&
    name !== base &&
    !seen.has(base)
  )
    chain.push(base)
  for (const l of chain) {
    const ast = ws.astOf(l)
    if (!ast) continue
    const stack = [ast.body]
    while (stack.length) {
      for (const n of stack.pop()!) {
        if (n.k === 'slot-outlet') {
          if (n.name) out.add(n.name)
          stack.push(n.fallback)
        } else if (n.k === 'element') stack.push(n.children)
        else if (n.k === 'if') for (const b of n.branches) stack.push(b.body)
        else if (n.k === 'for') stack.push(n.body, n.empty ?? [])
        else if (n.k === 'switch') stack.push(...n.cases.map((c) => c.body), n.default ?? [])
        else if (n.k === 'slot-fill') stack.push(n.body)
      }
    }
  }
  return [...out]
}

export function completions(
  ws: Workspace,
  uri: string,
  text: string,
  offset: number,
): CompletionItem[] {
  const c = cursorContext(text, offset)
  switch (c.kind) {
    case 'keyword':
      return Object.entries(KEYWORDS).map(([label, insertText]) => ({
        label,
        kind: KEYWORD,
        insertText,
        insertTextFormat: SNIPPET,
      }))
    case 'pipe':
      return ws.pipeNames().map((label) => ({ label, kind: FUNCTION }))
    case 'validator':
      return ws.validatorNames().map((label) => ({ label, kind: FUNCTION }))
    case 'tag': {
      const dir = ws.componentsDir()
      return ws
        .names()
        .filter((n) => n.startsWith(`${dir}/`))
        .map((n) => {
          const tag = ws.view.componentTag(n, dir)
          const required = (ws.astOf(n)?.inputs ?? []).filter((i) => !i.default)
          const attrs = required.map((i, k) => ` [${i.name}]="$${k + 1}"`).join('')
          return {
            label: tag,
            kind: CLASS,
            insertText: `${tag}${attrs} />`,
            insertTextFormat: SNIPPET,
          }
        })
    }
    case 'attr': {
      const name = componentOf(ws, c.tag)
      if (!name) return []
      const inputs = ws.astOf(name)?.inputs ?? []
      return [
        ...inputs.flatMap((i) => [
          {
            label: `[${i.name}]`,
            kind: PROPERTY,
            insertText: `[${i.name}]="$1"`,
            insertTextFormat: SNIPPET,
          },
          {
            label: i.name,
            kind: PROPERTY,
            insertText: `${i.name}="$1"`,
            insertTextFormat: SNIPPET,
          },
        ]),
        { label: 'class', kind: PROPERTY },
        { label: 'id', kind: PROPERTY },
      ]
    }
    case 'template-name': {
      const dir = ws.componentsDir()
      return ws
        .names()
        .filter((n) => !n.startsWith(`${dir}/`))
        .map((label) => ({ label, kind: FILE }))
    }
    case 'slot-name':
      return layoutSlots(ws, ws.nameOf(uri)).map((label) => ({ label, kind: PROPERTY }))
    case 'expr':
      // Form state is in every template: errors, what was typed, flash messages.
      return [...new Set([...c.scope, ...FORM_STATE])].map((label) => ({ label, kind: VARIABLE }))
    default:
      return []
  }
}
