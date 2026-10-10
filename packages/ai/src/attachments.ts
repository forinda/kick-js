/**
 * Turn an uploaded file into an {@link Attachment} for a `user` message.
 *
 * Takes the shape `ctx.file` has on every runtime (`buffer`, `mimetype`,
 * `originalname`), so a controller goes straight from upload to model:
 *
 * ```ts
 * @Post('/invoices/read')
 * @FileUpload({ mode: 'single', fieldName: 'invoice', allowedTypes: ['pdf', 'png', 'jpg'] })
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
 * Throws for a type no supported provider reads, so a `.docx` fails here
 * with its type named rather than as an opaque provider error.
 */
import type { Attachment, DocumentMediaType, ImageMediaType } from './types'

const IMAGE_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]
const DOCUMENT_TYPES: readonly DocumentMediaType[] = ['application/pdf', 'text/plain']

export interface UploadedFileForAi {
  buffer: Uint8Array
  mimetype: string
  originalname?: string
}

export function attachmentFromFile(file: UploadedFileForAi): Attachment {
  // `image/jpg` is common in the wild; providers only know `image/jpeg`.
  const type = file.mimetype.toLowerCase().split(';')[0]!.trim().replace('image/jpg', 'image/jpeg')
  const data = Buffer.from(file.buffer).toString('base64')
  if ((IMAGE_TYPES as readonly string[]).includes(type)) {
    return { type: 'image', data, mediaType: type as ImageMediaType }
  }
  if ((DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return {
      type: 'document',
      data,
      mediaType: type as DocumentMediaType,
      ...(file.originalname ? { name: file.originalname } : {}),
    }
  }
  throw new Error(
    `attachmentFromFile: "${file.mimetype}"${file.originalname ? ` (${file.originalname})` : ''} ` +
      `isn't a type the model can read. Supported: ${[...IMAGE_TYPES, ...DOCUMENT_TYPES].join(', ')}.`,
  )
}

/** The attachments a message may send: only `user` messages carry any. */
export function assertAttachmentsAllowed(
  role: string,
  attachments: readonly Attachment[] | undefined,
): void {
  if (attachments?.length && role !== 'user') {
    throw new Error(`Attachments go on user messages; this one is "${role}".`)
  }
}
