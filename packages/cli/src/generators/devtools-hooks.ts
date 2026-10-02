/**
 * The commented-out `introspect()` / `devtoolsTabs()` hooks that
 * `kick g adapter` and `kick g plugin` both write — one copy, so the two
 * examples can't drift from the real types.
 */
export function devtoolsHooks(
  kebab: string,
  pascal: string,
  kind: 'adapter' | 'plugin',
  indent: string,
): string {
  const block = `/**
 * Snapshot for the DevTools topology view (\`/_debug\`).
 *
 * Must be CHEAP — the topology endpoint polls on a short interval, so
 * \`state\` and \`metrics\` should be counters and flags already in memory,
 * never a database round trip.
 *
 * Uncomment with: import type { IntrospectionSnapshot } from '@forinda/kickjs'
 * Delete this hook if the ${kind} has nothing worth showing.
 */
// introspect(): IntrospectionSnapshot {
//   return {
//     protocolVersion: 1,
//     name: '${kebab}',
//     kind: '${kind}',
//     state: { connected: true },
//     metrics: { handled: 0 },
//     tokens: { provides: [], requires: [] },
//   }
// },

/**
 * DevTools panels this ${kind} contributes — a sidebar tab showing HTML,
 * an iframe (\`view: { type: 'iframe', src: '/your-panel' }\`), or buttons.
 *
 * Uncomment with: import { defineDevtoolsTab } from '@forinda/kickjs-devtools-kit'
 * and add the kit as a dependency: \`pnpm add @forinda/kickjs-devtools-kit\`.
 * (\`@forinda/kickjs\` deliberately does not depend on it.)
 * Delete this hook unless the ${kind} ships a panel.
 */
// devtoolsTabs() {
//   return [
//     defineDevtoolsTab({
//       id: '${kebab}',
//       title: '${pascal}',
//       view: { type: 'html', html: '<p>${pascal} ${kind}</p>' },
//     }),
//   ]
// },`
  return block
    .split('\n')
    .map((line) => indent + line)
    .join('\n')
}
