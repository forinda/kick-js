/**
 * Content parts sent with a user message: what a file is (from its bytes, not
 * its claimed MIME type), attachmentFromFile for uploads, and the exact wire
 * shapes each provider sends.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider, OpenAIProvider, attachmentFromFile } from '@forinda/kickjs-ai'
import type { ChatMessage, ContentPart } from '@forinda/kickjs-ai'

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pdf = Buffer.from('%PDF-1.7\n')
const csv = Buffer.from('name,qty\nwidget,3\n')
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]) // what an xlsx / docx is
const b64 = (b: Buffer) => b.toString('base64')

afterEach(() => vi.restoreAllMocks())

describe('attachmentFromFile', () => {
  it('trusts the bytes, not the MIME type the upload claimed', () => {
    // A Windows browser sends a .csv as application/vnd.ms-excel.
    const sheet = attachmentFromFile({
      buffer: csv,
      mimetype: 'application/vnd.ms-excel',
      originalname: 'stock.csv',
    })
    expect(sheet).toEqual({
      type: 'file',
      data: csv,
      mimeType: 'application/vnd.ms-excel',
      filename: 'stock.csv',
    })
    expect(attachmentFromFile({ buffer: png, mimetype: 'application/octet-stream' })).toMatchObject(
      {
        type: 'file',
      },
    )
  })

  it('decodes text in the charset the upload declares, and never lossily', async () => {
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9]) // "café" in ISO-8859-1
    const utf16 = Buffer.from('\uFEFFnaïve', 'utf16le')
    const sent: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)).messages[0].content[0].text)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    for (const [data, mimeType] of [
      [latin1, 'text/plain; charset=ISO-8859-1'],
      [utf16, 'text/csv; charset="utf-16le"'],
    ] as const) {
      await provider.chat({
        messages: [{ role: 'user', content: '', attachments: [{ type: 'file', data, mimeType }] }],
      })
    }
    expect(sent).toEqual(['café', 'naïve'])
    // No charset declared: Latin-1 bytes aren't UTF-8, so the file is refused, not mangled.
    expect(() =>
      attachmentFromFile({ buffer: latin1, mimetype: 'text/plain', originalname: 'old.csv' }),
    ).toThrow(/"old\.csv"/)
  })

  it('refuses what no model reads inline, naming the file, unless the app normalizes it', () => {
    const xlsx = { buffer: zip, mimetype: 'application/vnd.ms-excel', originalname: 'q3.xlsx' }
    expect(() => attachmentFromFile(xlsx)).toThrow(/"q3\.xlsx".*Normalize it first/)
    expect(attachmentFromFile(xlsx, { normalize: () => 'region,total\neast,10' })).toEqual({
      type: 'file',
      data: new TextEncoder().encode('region,total\neast,10'),
      mimeType: 'text/plain',
      filename: 'q3.xlsx',
    })
    const part: ContentPart = { type: 'text', text: 'converted elsewhere' }
    expect(attachmentFromFile(xlsx, { normalize: () => part })).toBe(part)
    expect(() => attachmentFromFile(xlsx, { normalize: () => undefined })).toThrow(/q3\.xlsx/)
    // What normalize returns is checked too, up front and naming the upload.
    expect(() =>
      attachmentFromFile(xlsx, {
        normalize: () => ({ type: 'file', data: zip, mimeType: 'application/zip' }),
      }),
    ).toThrow(/normalize\(\) for "q3\.xlsx" returned a part the model can't read/)
    expect(() =>
      attachmentFromFile(xlsx, {
        normalize: () => ({ type: 'file', data: 'https://e.com/q3.csv', mimeType: 'text/csv' }),
      }),
    ).toThrow(/"q3\.xlsx".*only image and PDF URLs/)
  })
})

/** Every kind of part, in the shapes other SDKs use: bytes, base64, data URL, URL. */
const parts: ContentPart[] = [
  { type: 'image', data: png, mimeType: 'image/png' },
  { type: 'image', data: 'https://example.com/a.jpg', mimeType: 'image/jpeg' },
  {
    type: 'file',
    data: `data:application/pdf;base64,${b64(pdf)}`,
    mimeType: 'application/pdf',
    filename: 'invoice.pdf',
  },
  { type: 'file', data: b64(csv), mimeType: 'text/csv', filename: 'stock.csv' },
  { type: 'text', text: 'Context: Q3 numbers.' },
]

describe('AnthropicProvider with attachments', () => {
  function setup() {
    const bodies: any[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      // A 400 ends the call once the request is captured.
      return new Response(JSON.stringify({ type: 'error', error: { type: 'x', message: 'x' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new Anthropic({ apiKey: 'sk-test', fetch: fetch as never, maxRetries: 0 })
    return { provider: new AnthropicProvider({ client }), bodies }
  }

  it('sends image, document and text blocks ahead of the message text', async () => {
    const { provider, bodies } = setup()
    await provider
      .chat({ messages: [{ role: 'user', content: 'Summarise these.', attachments: parts }] })
      .catch(() => {})
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(png) } },
          { type: 'image', source: { type: 'url', url: 'https://example.com/a.jpg' } },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: b64(pdf) },
            title: 'invoice.pdf',
          },
          {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: csv.toString() },
            title: 'stock.csv',
          },
          { type: 'text', text: 'Context: Q3 numbers.' },
          { type: 'text', text: 'Summarise these.' },
        ],
      },
    ])
  })

  it('sends a file alone without an empty text block, and refuses attachments off user turns', async () => {
    const { provider, bodies } = setup()
    await provider
      .chat({ messages: [{ role: 'user', content: '', attachments: [parts[0]!] }] })
      .catch(() => {})
    expect(bodies[0].messages[0].content).toHaveLength(1)
    const system: ChatMessage = { role: 'system', content: 'x', attachments: [parts[0]!] }
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

  it('sends image_url, file and text parts ahead of the message text', async () => {
    const { provider, bodies } = setup()
    await provider.chat({
      messages: [{ role: 'user', content: 'Summarise these.', attachments: parts }],
    })
    expect(bodies[0].messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(png)}` } },
          { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
          {
            type: 'file',
            file: { filename: 'invoice.pdf', file_data: `data:application/pdf;base64,${b64(pdf)}` },
          },
          { type: 'text', text: `stock.csv:\n${csv.toString()}` },
          { type: 'text', text: 'Context: Q3 numbers.' },
          { type: 'text', text: 'Summarise these.' },
        ],
      },
    ])
  })

  it('refuses a PDF by URL and a binary it cannot read, before any request', async () => {
    const { provider, bodies } = setup()
    await expect(
      provider.chat({
        messages: [
          {
            role: 'user',
            content: 'x',
            attachments: [
              { type: 'file', data: 'https://e.com/a.pdf', mimeType: 'application/pdf' },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/does not fetch PDFs by URL/)
    await expect(
      provider.chat({
        messages: [
          {
            role: 'user',
            content: 'x',
            attachments: [
              { type: 'file', data: zip, mimeType: 'application/zip', filename: 'a.zip' },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/"a\.zip" isn't an image, a PDF or text/)
    expect(bodies).toHaveLength(0)
  })
})
