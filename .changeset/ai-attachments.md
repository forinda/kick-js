---
'@forinda/kickjs-ai': minor
---

Send files to the model: images and documents on a `user` message's new `attachments`, with `content` unchanged.

- **`attachments`:** each one is an image (base64 png / jpeg / gif / webp, or a URL) or a document (base64 PDF or plain text, or a PDF URL). Files go ahead of the message text.
- **`attachmentFromFile(ctx.file)`:** builds an attachment from an upload on any runtime. It throws, naming the file, for a type no provider reads (`.docx`) before any call is made.
- **Anthropic:** sends native image and document blocks; plain text becomes a text document.
- **OpenAI:** sends `image_url` (URL or data URL), a `file` part for PDFs, and a text part for plain text. A document by URL throws, because Chat Completions can't fetch one.
- **Roles:** attachments are allowed on `user` messages only; any other role throws.
- **Compatible:** `ChatMessage.content` is still a string, so existing code and stored histories are unaffected.
