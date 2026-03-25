# Full API

**What it shows:** All framework features composed together.

- CSRF protection with `csrf()` middleware
- File upload with `upload.single()` and `cleanupFiles()`
- Full middleware pipeline (requestId, JSON parser, cookie parser, CSRF)
- Health check adapter
- Request logging middleware
- Swagger with all decorators
- Query parsing with field restrictions

## Running

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build
cd examples/full-api
pnpm dev
```

[View source on GitHub](https://github.com/forinda/kick-js/tree/main/examples/full-api)
