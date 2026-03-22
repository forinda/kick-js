# SSE Example

Server-Sent Events example demonstrating `ctx.sse()` for real-time streaming.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/events/clock` | Sends a `tick` event every second with the current time |
| `GET /api/v1/events/counter` | Sends incrementing `count` events every 500ms with event IDs |
| `GET /api/v1/events/notifications` | Sends mock `notification` events every 3s, accepts `?userId=` |

## Running

```bash
cd examples/sse-api
kick dev
```

## Testing with curl

```bash
curl -N http://localhost:3000/api/v1/events/clock
```

## Testing with JavaScript

```js
const source = new EventSource('http://localhost:3000/api/v1/events/clock')

source.addEventListener('tick', (event) => {
  console.log(JSON.parse(event.data))
})
```

## Source

- [examples/sse-api/](https://github.com/forinda/kick-js/tree/main/examples/sse-api)
