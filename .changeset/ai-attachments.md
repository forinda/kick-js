---
'@forinda/kickjs-ai': minor
---

Send files to the model. A `user` message's new `attachments` takes content parts in the shape other AI SDKs use, and `content` is unchanged.

- **`ContentPart`:** `{ type: 'text', text }`, `{ type: 'image', data, mimeType }` or `{ type: 'file', data, mimeType, filename? }`. `data` is raw bytes, base64, a `data:` URL, or an `http(s)://` URL. Parts go ahead of the message text.
- **Detected from the bytes, not the claimed MIME type:**
  - PNG, JPEG, GIF, WebP and PDF are recognised by their signatures.
  - Anything that is valid UTF-8 is sent as text: CSV, JSON, Markdown, XML, YAML, SQL, logs, code. A Windows `.csv` that arrives as `application/vnd.ms-excel` still works.
  - `mimeType` decides only for URLs, and only image and PDF URLs are sent.
  - Anything else (xlsx, docx, zip, audio) throws, naming the file, before any call is made.
- **`attachmentFromFile(ctx.file, { normalize })`:** builds a part from an upload on any runtime. `normalize` lets the app convert formats the default doesn't read (a sheet to CSV with SheetJS); the framework bundles no converters. The guide lists the default's limitations and has conversion recipes.
- **Anthropic:** native image and document blocks; text files become text documents titled with the file name.
- **OpenAI:** `image_url`, a `file` part for PDFs, and text parts. A PDF by URL throws, because Chat Completions can't fetch one.
- **Roles:** attachments are allowed on `user` messages only.
- **Compatible:** `ChatMessage.content` is still a string, so existing code and stored histories are unaffected.
