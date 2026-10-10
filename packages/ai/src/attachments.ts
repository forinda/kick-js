/**
 * Content parts — files and images sent with a `user` message — resolved into
 * what a provider can put on the wire, plus `attachmentFromFile` for uploads.
 *
 * What a file *is* comes from its bytes, not the MIME type it arrived with
 * (browsers disagree: a Windows `.csv` comes as `application/vnd.ms-excel`):
 * PNG, JPEG, GIF, WebP and PDF by their signatures, and anything that is
 * valid UTF-8 as text. Formats the models can't read inline are the app's to
 * normalize — `attachmentFromFile`'s `normalize` option.
 */
import type { ContentPart } from './types'

/** A part as a provider sends it. */
export type ResolvedPart =
  | { kind: 'image'; mediaType: string; base64?: string; url?: string }
  | { kind: 'pdf'; base64?: string; url?: string; filename?: string }
  | { kind: 'text'; text: string; filename?: string }

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0): boolean =>
  sig.every((b, i) => bytes[at + i] === b)

/** The type the bytes are, by signature — or undefined for anything else. */
function sniff(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return undefined
}

/** Valid UTF-8 with no NUL bytes is text; anything else isn't. */
function decodeText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined
  try {
    // Strip a byte-order mark; it isn't part of the text.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return undefined
  }
}

/** `data` as bytes, or as a URL to hand the provider. */
function source(data: Uint8Array | string): { bytes?: Uint8Array; url?: string } {
  if (typeof data !== 'string') return { bytes: data }
  if (/^https?:\/\//i.test(data)) return { url: data }
  const dataUrl = /^data:[^,]*?(;base64)?,(.*)$/s.exec(data)
  if (dataUrl) {
    return {
      bytes: dataUrl[1]
        ? Buffer.from(dataUrl[2]!, 'base64')
        : new TextEncoder().encode(decodeURIComponent(dataUrl[2]!)),
    }
  }
  return { bytes: Buffer.from(data, 'base64') }
}

/**
 * Work out what a part is and how to send it. Throws — naming the file — for
 * what no provider reads inline, so it fails before the call, not as a 400.
 */
export function resolvePart(part: ContentPart): ResolvedPart {
  if (part.type === 'text') return { kind: 'text', text: part.text }
  const filename = part.type === 'file' ? part.filename : undefined
  const label = filename ? `"${filename}"` : `This ${part.type}`
  const src = source(part.data)

  if (src.url !== undefined) {
    // No bytes to look at: the declared type is all there is.
    const hint = part.mimeType
      .toLowerCase()
      .split(';')[0]!
      .trim()
      .replace('image/jpg', 'image/jpeg')
    if (IMAGE_TYPES.has(hint)) return { kind: 'image', mediaType: hint, url: src.url }
    if (hint === 'application/pdf') return { kind: 'pdf', url: src.url, filename }
    throw new Error(
      `${label} is a URL to a ${hint || 'file of unknown type'}: only image and PDF URLs can be sent — fetch it and send the contents.`,
    )
  }

  const bytes = src.bytes!
  const type = sniff(bytes)
  if (type === 'application/pdf') {
    return { kind: 'pdf', base64: Buffer.from(bytes).toString('base64'), filename }
  }
  if (type) return { kind: 'image', mediaType: type, base64: Buffer.from(bytes).toString('base64') }
  const text = decodeText(bytes)
  if (text !== undefined) return { kind: 'text', text, filename }
  throw new Error(
    `${label} isn't an image, a PDF or text, so the model can't read it inline. ` +
      `Normalize it first — convert it to text (a sheet to CSV, a document to Markdown), ` +
      `for example with attachmentFromFile's normalize option.`,
  )
}

export interface UploadedFileForAi {
  buffer: Uint8Array
  mimetype: string
  originalname?: string
}

export interface AttachmentFromFileOptions {
  /**
   * Normalize a file the model can't read inline (xlsx, docx, …) with a
   * library of your choice — return its text (SheetJS: a sheet as CSV), or a
   * content part, or `undefined` to refuse it. Not called for images, PDFs
   * or text.
   */
  normalize?: (file: UploadedFileForAi) => string | ContentPart | undefined
}

/**
 * A content part for an uploaded file — `ctx.file` on any runtime:
 *
 * ```ts
 * @Post('/invoices/read')
 * @FileUpload({ mode: 'single', fieldName: 'invoice' })
 * async read(ctx: RequestContext) {
 *   const res = await this.ai.getProvider().chat({
 *     messages: [{
 *       role: 'user',
 *       content: 'List the line items as JSON.',
 *       attachments: [attachmentFromFile(ctx.file!)],
 *     }],
 *   })
 *   ctx.json(res)
 * }
 * ```
 *
 * Images, PDFs and anything that is text (CSV, JSON, Markdown, code, …) go as
 * they are, whatever MIME type the upload claimed. Other formats throw,
 * naming the file, unless `normalize` converts them.
 */
export function attachmentFromFile(
  file: UploadedFileForAi,
  options: AttachmentFromFileOptions = {},
): ContentPart {
  const part: ContentPart = {
    type: 'file',
    data: file.buffer,
    mimeType: file.mimetype,
    ...(file.originalname ? { filename: file.originalname } : {}),
  }
  try {
    resolvePart(part)
    return part
  } catch (err) {
    const normalized = options.normalize?.(file)
    if (normalized === undefined) throw err
    if (typeof normalized !== 'string') return normalized
    return {
      type: 'file',
      data: new TextEncoder().encode(normalized),
      mimeType: 'text/plain',
      ...(file.originalname ? { filename: file.originalname } : {}),
    }
  }
}

/** Only `user` messages carry attachments. */
export function assertAttachmentsAllowed(
  role: string,
  attachments: readonly ContentPart[] | undefined,
): void {
  if (attachments?.length && role !== 'user') {
    throw new Error(`Attachments go on user messages; this one is "${role}".`)
  }
}
