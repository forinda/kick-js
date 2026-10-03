/** Named shared apps: one app per name, built from the first caller's options. */
import { expect, it } from 'vitest'
import { createTestModule } from '../src/index'
import { useTestApp } from '../src/vitest'

const Empty = createTestModule({ register: () => {}, routes: () => null })

let builds = 0
const options = () => {
  builds++
  return { modules: [Empty], isolated: true }
}

const a = useTestApp(options, { shared: 'docs-a' })
const again = useTestApp(options, { shared: 'docs-a' })
const b = useTestApp(options, { shared: 'docs-b' })

it('reuses the app for a name, and builds another for a new name', () => {
  expect(again.app).toBe(a.app)
  expect(b.app).not.toBe(a.app)
  expect(builds).toBe(2)
})
