/**
 * The WebSocket example in docs/guide/testing/background.md: start the app
 * on an ephemeral port, connect a real client, shut down.
 */
import 'reflect-metadata'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { Application } from '@forinda/kickjs'
import { OnMessage, WsAdapter, WsController, type WsContext } from '@forinda/kickjs-ws'

@WsController('/chat')
class ChatController {
  @OnMessage('ping')
  ping(ctx: WsContext) {
    ctx.send('pong', { at: 'server' })
  }
}
void ChatController

let app: Application
let url: string

beforeAll(async () => {
  app = new Application({
    modules: [],
    adapters: [WsAdapter({ heartbeatInterval: 0 })],
    port: 0, // any free port
  })
  await app.start()
  const { port } = app.getHttpServer()!.address() as AddressInfo
  url = `ws://127.0.0.1:${port}/ws/chat`
})

afterAll(() => app.shutdown())

it('answers a message', async () => {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
  const reply = new Promise<unknown>((resolve) =>
    ws.once('message', (m) => resolve(JSON.parse(String(m)))),
  )
  ws.send(JSON.stringify({ event: 'ping', data: {} }))
  expect(await reply).toEqual({ event: 'pong', data: { at: 'server' } })
  ws.close()
})
