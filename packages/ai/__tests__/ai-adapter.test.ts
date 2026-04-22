/**
 * Tests for `AiAdapter` tool discovery + `runAgent` loop.
 *
 * Three layers:
 *   1. Unit tests on the registry — `@AiTool` methods are discovered
 *      via `onRouteMount` + `beforeStart`, Zod body schemas convert
 *      to JSON Schema, auto-named tools, explicit name override.
 *   2. Agent loop tests with a fake in-memory provider — verify the
 *      chat → tool-call → dispatch → feedback loop terminates on
 *      final text, honors maxSteps, handles missing tools gracefully.
 *   3. E2E tests with a real http.Server — prove dispatch routes
 *      through the Express pipeline and returns real controller
 *      responses to the model.
 *
 * @module @forinda/kickjs-ai/__tests__/ai-adapter.test
 */

import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import express, { type Express } from 'express'
import { z } from 'zod'
import { Container, Controller, Get, Post } from '@forinda/kickjs'
import { AiAdapter, AiTool } from '@forinda/kickjs-ai'
import type {
  AiProvider,
  ChatInput,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  EmbedInput,
} from '@forinda/kickjs-ai'

// ── Fixtures ──────────────────────────────────────────────────────────────

const createTaskSchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']),
})

let createCalls: unknown[] = []
let listCalls: unknown[] = []

@Controller()
class TaskController {
  @Get('/')
  @AiTool({ description: 'List all tasks, optionally filtered by status' })
  list(req: any, res: any) {
    listCalls.push(req.query)
    res.json([{ id: '1', title: 'Example' }])
  }

  @Post('/', { body: createTaskSchema, name: 'CreateTask' })
  @AiTool({ description: 'Create a new task with a title and priority' })
  create(req: any, res: any) {
    createCalls.push(req.body)
    res.status(201).json({ id: 'created-1', ...req.body })
  }

  @Get('/internal')
  internal() {
    /* no @AiTool — should not be discovered */
  }
}

// ── Fake provider: scripted responses ────────────────────────────────────

/**
 * A scripted AiProvider for agent-loop tests.
 *
 * The script is a FIFO queue of responses — each `chat` call pops
 * the next one. That lets tests exercise multi-step loops by enqueuing
 * a tool-calling response followed by a plain-text one.
 */
class ScriptedProvider implements AiProvider {
  readonly name = 'scripted'
  public inputs: ChatInput[] = []
  private queue: ChatResponse[]

  constructor(responses: ChatResponse[]) {
    this.queue = [...responses]
  }

  async chat(input: ChatInput, _options?: ChatOptions): Promise<ChatResponse> {
    this.inputs.push(input)
    const next = this.queue.shift()
    if (!next) throw new Error('ScriptedProvider: no more responses scripted')
    return next
  }

  // eslint-disable-next-line require-yield
  async *stream(_input: ChatInput, _options?: ChatOptions) {
    throw new Error('ScriptedProvider.stream not used in these tests')
  }

  async embed(_input: EmbedInput): Promise<number[][]> {
    throw new Error('ScriptedProvider.embed not used in these tests')
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

interface Rig {
  adapter: AiAdapter
  app: Express
  server: http.Server
  port: number
  provider: ScriptedProvider
}

/**
 * Spin up a real http.Server with the TaskController mounted and
 * return a rig the tests can use to invoke `runAgent` against real
 * routes.
 */
async function startRig(scriptedResponses: ChatResponse[]): Promise<Rig> {
  const app = express()
  app.use(express.json())
  app.get('/api/v1/tasks/', TaskController.prototype.list)
  app.post('/api/v1/tasks/', TaskController.prototype.create)

  const provider = new ScriptedProvider(scriptedResponses)
  const adapter = AiAdapter({ provider })

  adapter.onRouteMount(TaskController, '/api/v1/tasks')
  adapter.beforeStart({ container: new Container() } as never)

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = http.createServer(app)
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => resolve(s))
  })

  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no address')
  adapter.afterStart({ app, container: {} as never, server } as never)

  return { adapter, app, server, port: address.port, provider }
}

async function stopRig(rig: Rig): Promise<void> {
  await rig.adapter.shutdown()
  await new Promise<void>((resolve) => rig.server.close(() => resolve()))
}

// ── Tool discovery ───────────────────────────────────────────────────────

describe('AiAdapter — tool discovery', () => {
  beforeEach(() => {
    Container.reset()
    createCalls = []
    listCalls = []
  })

  it('discovers every @AiTool-decorated method after beforeStart', () => {
    const adapter = AiAdapter({ provider: new ScriptedProvider([]) })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const tools = adapter.getTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['TaskController.create', 'TaskController.list'])
  })

  it('skips methods without @AiTool', () => {
    const adapter = AiAdapter({ provider: new ScriptedProvider([]) })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const names = adapter.getTools().map((t) => t.name)
    expect(names).not.toContain('TaskController.internal')
  })

  it('converts the Zod body schema to a JSON Schema input', () => {
    const adapter = AiAdapter({ provider: new ScriptedProvider([]) })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const create = adapter.getTools().find((t) => t.name === 'TaskController.create')
    expect(create).toBeDefined()
    expect(create!.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        title: { type: 'string' },
        priority: expect.objectContaining({ enum: ['low', 'medium', 'high'] }),
      },
    })
    expect(create!.httpMethod).toBe('POST')
    expect(create!.mountPath).toBe('/api/v1/tasks')
  })

  it('uses an empty object schema for routes without a body', () => {
    const adapter = AiAdapter({ provider: new ScriptedProvider([]) })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const list = adapter.getTools().find((t) => t.name === 'TaskController.list')
    expect(list).toBeDefined()
    expect(list!.inputSchema).toMatchObject({
      type: 'object',
      properties: {},
    })
  })
})

// ── runAgent: unit tests with a fake provider ────────────────────────────

describe('AiAdapter.runAgent — unit', () => {
  beforeEach(() => {
    Container.reset()
    createCalls = []
    listCalls = []
  })

  it('returns immediately when the model does not request tools', async () => {
    const provider = new ScriptedProvider([
      { content: 'Hello there!', finishReason: 'stop' },
    ])
    const adapter = AiAdapter({ provider })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const result = await adapter.runAgent({
      messages: [{ role: 'user', content: 'hi' }],
    })

    expect(result.content).toBe('Hello there!')
    expect(result.steps).toBe(1)
    expect(provider.inputs).toHaveLength(1)
  })

  it('passes discovered tools to the provider when tools is auto', async () => {
    const provider = new ScriptedProvider([
      { content: 'nothing to do', finishReason: 'stop' },
    ])
    const adapter = AiAdapter({ provider })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    await adapter.runAgent({
      messages: [{ role: 'user', content: 'hi' }],
      tools: 'auto',
    })

    const toolsSent = provider.inputs[0].tools
    expect(Array.isArray(toolsSent)).toBe(true)
    expect((toolsSent as ReadonlyArray<{ name: string }>).map((t) => t.name).sort()).toEqual([
      'TaskController.create',
      'TaskController.list',
    ])
  })

  it('omits tools from the provider call when none are discovered', async () => {
    const provider = new ScriptedProvider([{ content: 'ok', finishReason: 'stop' }])
    const adapter = AiAdapter({ provider })
    // No onRouteMount → no tools discovered
    adapter.beforeStart({ container: new Container() } as never)

    await adapter.runAgent({
      messages: [{ role: 'user', content: 'hi' }],
      tools: 'auto',
    })

    expect(provider.inputs[0].tools).toBeUndefined()
  })

  it('stops after maxSteps and flags the result', async () => {
    // Provider keeps requesting the same tool call forever
    const loopingResponse: ChatResponse = {
      content: '',
      toolCalls: [{ id: 'call_1', name: 'TaskController.list', arguments: {} }],
      finishReason: 'tool_calls',
    }
    const provider = new ScriptedProvider(
      Array.from({ length: 20 }, () => loopingResponse),
    )

    const rig = await startRig([])
    // Swap the adapter's provider by building a fresh adapter on the
    // same HTTP server so dispatch still works.
    const adapter = AiAdapter({ provider })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)
    adapter.setServerBaseUrl(`http://127.0.0.1:${rig.port}`)

    const result = await adapter.runAgent({
      messages: [{ role: 'user', content: 'infinite loop' }],
      tools: 'auto',
      maxSteps: 3,
    })

    expect(result.maxStepsReached).toBe(true)
    expect(result.steps).toBe(3)
    await stopRig(rig)
  })

  it('surfaces "tool not found" errors without crashing the loop', async () => {
    const provider = new ScriptedProvider([
      {
        content: '',
        toolCalls: [{ id: 'call_1', name: 'NonexistentTool', arguments: {} }],
        finishReason: 'tool_calls',
      },
      { content: "sorry, I couldn't do that", finishReason: 'stop' },
    ])
    const adapter = AiAdapter({ provider })
    adapter.onRouteMount(TaskController, '/api/v1/tasks')
    adapter.beforeStart({ container: new Container() } as never)

    const result = await adapter.runAgent({
      messages: [{ role: 'user', content: 'do a thing' }],
      tools: 'auto',
    })

    expect(result.content).toContain("sorry")
    // The second chat call should see the error in the tool message
    const secondInput = provider.inputs[1]
    const toolMessage = secondInput.messages.find((m: ChatMessage) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    expect(toolMessage!.content).toContain('Tool not found')
  })
})

// ── runAgent: e2e tests with a real http.Server ──────────────────────────

describe('AiAdapter.runAgent — e2e dispatch', () => {
  let rig: Rig | null = null

  beforeEach(() => {
    Container.reset()
    createCalls = []
    listCalls = []
    rig = null
  })

  afterEach(async () => {
    if (rig) await stopRig(rig)
  })

  it('dispatches a tool call to the real http server and feeds the result back', async () => {
    rig = await startRig([
      // Round 1: model requests the create tool
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'TaskController.create',
            arguments: { title: 'Ship MCP', priority: 'high' },
          },
        ],
        finishReason: 'tool_calls',
      },
      // Round 2: model produces the final answer
      { content: 'Task created with id created-1.', finishReason: 'stop' },
    ])

    const result = await rig.adapter.runAgent({
      messages: [
        { role: 'system', content: 'Use tools to fulfill the user request.' },
        { role: 'user', content: 'Create a high-priority task titled Ship MCP' },
      ],
      tools: 'auto',
    })

    expect(result.content).toBe('Task created with id created-1.')
    expect(result.steps).toBe(2)

    // Controller actually saw the call
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0]).toEqual({ title: 'Ship MCP', priority: 'high' })

    // The tool result message was fed back to the provider
    const secondInput = rig.provider.inputs[1]
    const toolMessage = secondInput.messages.find((m: ChatMessage) => m.role === 'tool')
    expect(toolMessage).toBeDefined()
    expect(toolMessage!.toolCallId).toBe('call_1')
    expect(toolMessage!.content).toContain('created-1')
    expect(toolMessage!.content).toContain('Ship MCP')
  })

  it('serializes args as query string for GET tool dispatch', async () => {
    rig = await startRig([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'TaskController.list',
            arguments: { status: 'todo', limit: 10 },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Found 1 task.', finishReason: 'stop' },
    ])

    await rig.adapter.runAgent({
      messages: [{ role: 'user', content: 'list my tasks' }],
      tools: 'auto',
    })

    expect(listCalls).toHaveLength(1)
    expect(listCalls[0]).toMatchObject({ status: 'todo', limit: '10' })
  })

  it('accumulates token usage across the agent loop', async () => {
    rig = await startRig([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'TaskController.create',
            arguments: { title: 'X', priority: 'low' },
          },
        ],
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      },
      {
        content: 'Done.',
        usage: { promptTokens: 150, completionTokens: 5, totalTokens: 155 },
      },
    ])

    const result = await rig.adapter.runAgent({
      messages: [{ role: 'user', content: 'create X' }],
      tools: 'auto',
    })

    expect(result.usage).toEqual({
      promptTokens: 250,
      completionTokens: 25,
      totalTokens: 275,
    })
  })
})
