# Socket.IO Integration

KickJS ships with a `ws`-based WebSocket adapter (`@forinda/kickjs-ws`), but you can integrate **Socket.IO** for features like automatic reconnection, rooms, acknowledgements, and binary support.

## Setup

```bash
pnpm add socket.io
```

## Create a Socket.IO Adapter

```ts
// src/adapters/socketio.adapter.ts
import { Server, type Socket } from 'socket.io'
import { Logger, type AppAdapter, type AdapterContext } from '@forinda/kickjs-core'

const log = Logger.for('SocketIOAdapter')

export interface SocketIOAdapterOptions {
  /** CORS configuration */
  cors?: {
    origin: string | string[]
    methods?: string[]
    credentials?: boolean
  }
  /** Path for the Socket.IO endpoint (default: '/socket.io') */
  path?: string
  /** Custom namespaces to register */
  namespaces?: SocketIONamespace[]
}

export interface SocketIONamespace {
  /** Namespace path (e.g. '/chat', '/notifications') */
  namespace: string
  /** Handler setup function — receives the namespace and DI container */
  setup: (nsp: any, container: Container) => void
}

export class SocketIOAdapter implements AppAdapter {
  name = 'SocketIOAdapter'
  private io: Server | null = null

  constructor(private options: SocketIOAdapterOptions = {}) {}

  afterStart({ server, container }: AdapterContext): void {
    this.io = new Server(server, {
      cors: this.options.cors ?? { origin: '*' },
      path: this.options.path ?? '/socket.io',
    })

    // Default namespace
    this.io.on('connection', (socket: Socket) => {
      log.info(`Connected: ${socket.id}`)

      socket.on('disconnect', (reason) => {
        log.info(`Disconnected: ${socket.id} (${reason})`)
      })
    })

    // Custom namespaces
    for (const ns of this.options.namespaces ?? []) {
      const nsp = this.io.of(ns.namespace)
      ns.setup(nsp, container)
      log.info(`Namespace registered: ${ns.namespace}`)
    }

    // Register io instance in DI for injection
    container.registerInstance(SOCKET_IO, this.io)

    log.info(`Socket.IO listening at ${this.options.path ?? '/socket.io'}`)
  }

  async shutdown(): Promise<void> {
    if (this.io) {
      await new Promise<void>((resolve) => this.io!.close(() => resolve()))
      log.info('Socket.IO server closed')
    }
  }
}

/** DI token for injecting the Socket.IO server */
export const SOCKET_IO = Symbol('SocketIO')
```

## Register in Bootstrap

```ts
import { bootstrap } from '@forinda/kickjs-http'
import { SocketIOAdapter } from './adapters/socketio.adapter'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new SocketIOAdapter({
      cors: { origin: 'http://localhost:5173', credentials: true },
      namespaces: [
        {
          namespace: '/chat',
          setup: (nsp, container) => {
            nsp.on('connection', (socket) => {
              console.log(`Chat connected: ${socket.id}`)

              socket.on('message', (data) => {
                // Broadcast to room or all
                nsp.emit('message', {
                  from: socket.id,
                  ...data,
                  timestamp: new Date().toISOString(),
                })
              })

              socket.on('join-room', (room) => {
                socket.join(room)
                socket.to(room).emit('user-joined', { userId: socket.id })
              })

              socket.on('leave-room', (room) => {
                socket.leave(room)
                socket.to(room).emit('user-left', { userId: socket.id })
              })
            })
          },
        },
        {
          namespace: '/notifications',
          setup: (nsp, container) => {
            nsp.on('connection', (socket) => {
              // Join user-specific room for targeted notifications
              const userId = socket.handshake.auth?.userId
              if (userId) socket.join(`user:${userId}`)
            })
          },
        },
      ],
    }),
  ],
})
```

## Inject Socket.IO in Services

Use the `SOCKET_IO` token to inject the io server anywhere:

```ts
import { Service, Inject } from '@forinda/kickjs-core'
import { SOCKET_IO } from '../adapters/socketio.adapter'
import type { Server } from 'socket.io'

@Service()
export class NotificationPushService {
  constructor(@Inject(SOCKET_IO) private io: Server) {}

  /** Send a notification to a specific user */
  notifyUser(userId: string, event: string, data: any) {
    this.io.of('/notifications').to(`user:${userId}`).emit(event, data)
  }

  /** Broadcast to all connected clients */
  broadcast(event: string, data: any) {
    this.io.emit(event, data)
  }

  /** Send to a specific room */
  toRoom(room: string, event: string, data: any) {
    this.io.to(room).emit(event, data)
  }
}
```

## Client-Side

```ts
import { io } from 'socket.io-client'

// Connect to default namespace
const socket = io('http://localhost:3000')

// Connect to a specific namespace
const chat = io('http://localhost:3000/chat')
const notifications = io('http://localhost:3000/notifications', {
  auth: { userId: 'user-123' },
})

// Listen for events
chat.on('message', (msg) => console.log('New message:', msg))
notifications.on('alert', (alert) => console.log('Alert:', alert))

// Send events
chat.emit('message', { text: 'Hello everyone!' })
chat.emit('join-room', 'general')
```

## Socket.IO vs ws

| | `@forinda/kickjs-ws` | Socket.IO |
|---|---|---|
| **Protocol** | Raw WebSocket | Custom protocol over WebSocket/polling |
| **Reconnection** | Manual | Automatic |
| **Rooms** | Via `RoomManager` | Built-in |
| **Acknowledgements** | Manual | Built-in callbacks |
| **Binary** | Manual | Automatic |
| **Fallback** | WebSocket only | Long-polling fallback |
| **Bundle size** | ~50KB | ~300KB (client + server) |
| **Decorators** | `@WsController`, `@OnMessage` | Use adapter pattern above |
| **Best for** | Lightweight, low-level control | Full-featured real-time apps |

## With Authentication

```ts
// Middleware for Socket.IO authentication
io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (!token) return next(new Error('Authentication required'))

  try {
    const user = jwt.verify(token, JWT_SECRET)
    socket.data.user = user
    next()
  } catch {
    next(new Error('Invalid token'))
  }
})

// Access user in handlers
io.on('connection', (socket) => {
  console.log(`Authenticated user: ${socket.data.user.email}`)
})
```

## With KickJS Auth

If you're using `@forinda/kickjs-auth`, you can reuse your JWT strategy:

```ts
import { JwtStrategy } from '@forinda/kickjs-auth'

const jwtStrategy = new JwtStrategy({ secret: JWT_SECRET })

io.use(async (socket, next) => {
  // Create a mock request object for the strategy
  const mockReq = {
    headers: { authorization: `Bearer ${socket.handshake.auth?.token}` },
  }
  const user = await jwtStrategy.validate(mockReq)
  if (!user) return next(new Error('Unauthorized'))
  socket.data.user = user
  next()
})
```
