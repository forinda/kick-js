/**
 * Files sent to the model with a user message: building attachments from an
 * upload, and the exact wire shapes each provider sends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider, OpenAIProvider, attachmentFromFile } from '@forinda/kickjs-ai'
import type { Attachment, ChatMessage } from '@forinda/kickjs-ai'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64')

const attachments: Attachment[] = [
  { type: 'image', data: b64(png), mediaType: 'image/png' },
  { type: 'image', url: 'https://example.com/a.jpg' },
  { type: 'document', data: b64('%PDF-1.7'), mediaType: 'application/pdf', name: 'invoice.pdf' },
  { type: 'document', data: b64('line one'), mediaType: 'text/plain', name: 'notes.txt' },
]

afterEach(() => vi.restoreAllMocks())

describe('attachmentFromFile', () => {
  it('turns an upload into an image or document attachment', () => {
    expect(attachmentFromFile({ buffer: png, mimetype: 'image/png' })).toEqual({
      type: 'image',
      data: b64(png),
      mediaType: 'image/png',
    })
    expect(attachmentFromFile({ buffer: png, mimetype: 'image/jpg' })).toMatchObject({
      mediaType: 'image/jpeg',
    })
    expect(
      attachmentFromFile({
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      }),
    ).toEqual({ type: 'document', data: b64('%PDF'), mediaType: 'application/pdf', name: 'a.pdf' })
    expect(
      attachmentFromFile({ buffer: Buffer.from('hi'), mimetype: 'text/plain; charset=utf-8' }),
    ).toMatchObject({ type: 'document', mediaType: 'text/plain' })
  })

  it('names the type it cannot send', () => {
    expect(() =>
      attachmentFromFile({
        buffer: Buffer.from('x'),
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        originalname: 'brief.docx',
      }),
    ).toThrow(/brief\.docx.*Supported: image\/png/)
  })
})

describe('AnthropicProvider with attachments', () => {
  function setup() {
    const bodies: any[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      // Status 400 ends the call right after the request is captured.
      return new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'x' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new Anthropic({ apiKey: 'sk-test', fetch: fetch as never, maxRetries: 0 })
    return { provider: new AnthropicProvider({ client }), bodies }
  }

  it('sends image and document blocks ahead of the text', async () => {
    const { provider, bodies } = setup()
    await provider
      .chat({ messages: [{ role: 'user', content: 'Summarise these.', attachments }] })
      .catch(() => {})
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(png) } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.jpg' } },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64('%PDF-1.7') },
            title: 'invoice.pdf',
          },
          {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: 'line one' },
            title: 'notes.txt',
          },
          { type: 'text', text: 'Summarise these.' },
        ],
      },
    ])
  })

  it('sends a file alone without an empty text block, and refuses attachments off user turns', async () => {
    const { provider, bodies } = setup()
    await provider
      .chat({ messages: [{ role: 'user', content: '', attachments: [attachments[0]!] }] })
      .catch(() => {})
    expect(bodies[0].messages[0].content).toHaveLength(1)
    const system: ChatMessage = { role: 'system', content: 'x', attachments: [attachments[0]!] }
    await expect(
      provider.chat({ messages: [system, { role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/user messages; this one is "system"/)
  })
})

describe('OpenAIProvider with attachments', () => {
  function setup() {
    const bodies: any[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    return { provider: new OpenAIProvider({ apiKey: 'sk-test' }), bodies }
  }

  it('sends image_url, file and text parts ahead of the text', async () => {
    const { provider, bodies } = setup()
    const sendable = attachments.filter((a) => !(a.type === 'document' && 'url' in a))
    await provider.chat({
      messages: [{ role: 'user', content: 'Summarise these.', attachments: sendable }],
    })
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(png)}` } },
          { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
          {
            type: 'file',
            file: {
              filename: 'invoice.pdf',
              file_data: `data:application/pdf;base64,${b64('%PDF-1.7')}`,
            },
          },
          { type: 'text', text: 'notes.txt:\nline one' },
          { type: 'text', text: 'Summarise these.' },
        ],
      },
    ])
  })

  it('refuses a document by URL, which Chat Completions cannot fetch', async () => {
    const { provider } = setup()
    await expect(
      provider.chat({
        messages: [
          {
            role: 'user',
            content: 'x',
            attachments: [{ type: 'document', url: 'https://e.com/a.pdf' }],
          },
        ],
      }),
    ).rejects.toThrow(/does not fetch documents by URL/)
  })
})
