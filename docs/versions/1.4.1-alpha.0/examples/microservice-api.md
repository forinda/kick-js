# Microservice Example

REST API with OpenTelemetry tracing, DevTools, and Swagger — the microservice template.

## Features

- OTel adapter for automatic request tracing
- DevTools dashboard at `/_debug`
- Swagger at `/docs`
- CLI-generated health module
- Ready for queue workers (uncomment in index.ts)

## Running

```bash
cd examples/microservice-api
kick dev
```

## Source

- [examples/microservice-api/](https://github.com/forinda/kick-js/tree/main/examples/microservice-api)
- Created with: `kick new microservice-api --template microservice`
