/** `useTestApp` registers the hooks: the app is ready in every test, resets ran first. */
import { expect, it } from 'vitest'
import { Controller, Get } from '@forinda/kickjs'
import { createTestModule, onTestReset } from '../src/index'
import { useTestApp } from '../src/vitest'

@Controller()
class PingController {
  @Get('/')
  ping() {
    return { pong: true }
  }
}

const PingModule = createTestModule({
  register: () => {},
  routes: () => ({ path: '/ping', controller: PingController }),
})

// State left over from "another file": the reset before this file clears it.
const outbox: string[] = ['left over']
onTestReset(() => {
  outbox.length = 0
})

const t = useTestApp(() => ({ modules: [PingModule], isolated: true }), {
  client: { basePath: '/api/v1' },
})

it('ran the registered resets before the file', () => {
  expect(outbox).toEqual([])
})

it('exposes the app, its container and a client with the defaults given', async () => {
  expect(t.app.getActiveRuntime().name).toBe('express')
  expect(t.container).toBeDefined()
  await t.client().get('/ping').expect(200, { pong: true })
})
