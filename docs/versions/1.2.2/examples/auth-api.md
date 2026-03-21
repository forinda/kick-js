# Auth API

**What it shows:** Authentication and authorization patterns.

- JWT-like auth middleware using `@Middleware` decorator
- Protected routes (class-level and method-level auth)
- Public endpoints that opt out of auth
- Login/register endpoints with token generation
- User context extraction from tokens

## Running

```bash
git clone https://github.com/forinda/kick-js.git
cd kick-js
pnpm install && pnpm build
cd examples/auth-api
pnpm dev
```

[View source on GitHub](https://github.com/forinda/kick-js/tree/main/examples/auth-api)
