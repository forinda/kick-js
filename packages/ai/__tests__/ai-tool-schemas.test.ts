/**
 * AiAdapter tool names, input schemas and argument mapping through a real
 * Application: path parameters, non-Zod schemas, duplicate names, restarts.
 */
import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Application, Container, Controller, Post, Put, type RequestContext } from '@forinda/kickjs'
import { AiAdapter, AiTool } from '@forinda/kickjs-ai'
import type { AiProvider, ChatInput, ChatResponse } from '@forinda/kickjs-ai'

const apps: Application[] = []
let seen: unknown[] = []

beforeEach(() => {
  Container.reset()
  seen = []
})
afterEach(async () => {
  while (apps.length) await apps.pop()!.shutdown()
})

class ScriptedProvider implements AiProvider {
  readonly name = 'scripted'
  readonly inputs: ChatInput[] = []
  constructor(private readonly queue: ChatResponse[]) {}
  async chat(input: ChatInput): Promise<ChatResponse> {
    this.inputs.push(structuredClone(input))
    const next = this.queue.shift()
    if (!next) throw new Error('no scripted response left')
    return next
  }
  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<never> {
    throw new Error('not used')
  }
  async embed(): Promise<number[][]> {
    throw new Error('not used')
  }
}

const standardTitle = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: 'object', properties: { title: { type: 'string' } } }),
    },
  },
}

function modules() {
  @Controller()
  class TaskController {
    @Put('/:id', { body: z.object({ title: z.string() }) })
    @AiTool({ description: 'Rename a task' })
    rename(ctx: RequestContext) {
      seen.push({ id: ctx.params.id, body: ctx.body })
      ctx.json({ ok: true })
    }

    @Post('/', { body: standardTitle })
    @AiTool({ description: 'Create a task', name: 'create task!' })
    create(ctx: RequestContext) {
      ctx.json({ created: ctx.body }, 201)
    }
  }

  @Controller()
  class OtherController {
    @Post('/')
    @AiTool({ description: 'Same name after cleaning', name: 'create_task_' })
    create(ctx: RequestContext) {
      ctx.json({ other: true })
    }
  }

  return [
    { routes: () => ({ path: '/tasks', controller: TaskController }) },
    { routes: () => ({ path: '/other', controller: OtherController }) },
  ] as never[]
}

async function start(provider: AiProvider, adapter = AiAdapter({ provider })) {
  const app = new Application({ port: 0, modules: modules(), adapters: [adapter] } as never)
  await app.start()
  apps.push(app)
  return { app, adapter }
}

const toolCall = (name: string, args: Record<string, unknown>): ChatResponse => ({
  content: '',
  toolCalls: [{ id: 'call_1', name, arguments: args }],
  finishReason: 'tool_calls',
})

describe('AiAdapter — tool names', () => {
  it('defaults to Controller_method and cleans names providers would reject', async () => {
    const { adapter } = await start(new ScriptedProvider([]))
    const names = adapter.getTools().map((t) => t.name)
    expect(names).toContain('TaskController_rename')
    expect(names).toContain('create_task_')
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })

  it('keeps one tool per name when two clean to the same name', async () => {
    const { adapter } = await start(new ScriptedProvider([]))
    expect(adapter.getTools().filter((t) => t.name === 'create_task_')).toHaveLength(1)
  })

  it('does not list tools twice when the same instance starts again', async () => {
    const provider = new ScriptedProvider([])
    const adapter = AiAdapter({ provider })
    const { app } = await start(provider, adapter)
    const count = adapter.getTools().length
    await app.shutdown()
    apps.pop()
    Container.reset()
    await start(provider, adapter)
    expect(adapter.getTools()).toHaveLength(count)
  })
})

describe('AiAdapter — tool input', () => {
  it('lists the path parameter as a required field next to the body', async () => {
    const { adapter } = await start(new ScriptedProvider([]))
    const rename = adapter.getTools().find((t) => t.name === 'TaskController_rename')!
    expect(Object.keys(rename.inputSchema.properties as object).toSorted()).toEqual(['id', 'title'])
    expect((rename.inputSchema.required as string[]).toSorted()).toEqual(['id', 'title'])
  })

  it('reads a non-Zod Standard Schema body', async () => {
    const { adapter } = await start(new ScriptedProvider([]))
    const create = adapter.getTools().find((t) => t.name === 'create_task_')!
    expect(create.inputSchema.properties).toEqual({ title: { type: 'string' } })
  })

  it('fills the path parameter when the model calls the tool', async () => {
    const provider = new ScriptedProvider([
      toolCall('TaskController_rename', { id: '42', title: 'Ship' }),
      { content: 'done', finishReason: 'stop' },
    ])
    const { adapter } = await start(provider)
    const result = await adapter.runAgent({ messages: [{ role: 'user', content: 'rename' }] })

    expect(result.content).toBe('done')
    expect(seen).toEqual([{ id: '42', body: { title: 'Ship' } }])
  })

  it('returns a missing path parameter to the model as a tool error', async () => {
    const provider = new ScriptedProvider([
      toolCall('TaskController_rename', { title: 'Ship' }),
      { content: 'sorry', finishReason: 'stop' },
    ])
    const { adapter } = await start(provider)
    await adapter.runAgent({ messages: [{ role: 'user', content: 'rename' }] })

    expect(seen).toEqual([])
    const toolMessage = provider.inputs[1].messages.find((m) => m.role === 'tool')!
    expect(JSON.parse(toolMessage.content)).toEqual({
      error: 'Missing path parameter "id" for PUT /api/v1/tasks/:id',
    })
  })
})
