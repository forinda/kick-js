# Minimal Example

The simplest possible KickJS app — no adapters, no Swagger, just `bootstrap()` and one route.

## Features

- Single inline module with one GET route
- No external adapters
- ~10 lines of code

## Running

```bash
cd examples/minimal-api
kick dev
```

```bash
curl http://localhost:3000/api/v1/hello
# { "message": "Hello from KickJS minimal template" }
```

## Source

- [examples/minimal-api/](https://github.com/forinda/kick-js/tree/main/examples/minimal-api)
- Created with: `kick new minimal-api --template minimal`
