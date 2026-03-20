import { Autowired } from '@forinda/kickjs-core'
import {
  WsController,
  OnConnect,
  OnDisconnect,
  OnMessage,
  OnError,
  type WsContext,
} from '@forinda/kickjs-ws'
import { ChatService } from './chat.service'

@WsController('/chat')
export class ChatController {
  @Autowired() private chatService!: ChatService

  @OnConnect()
  handleConnect(ctx: WsContext) {
    const username = `user-${ctx.id.slice(0, 6)}`
    ctx.set('username', username)
    ctx.send('welcome', {
      id: ctx.id,
      username,
      message: 'Welcome to the chat!',
      onlineCount: this.chatService.getOnlineCount() + 1,
    })
    this.chatService.addUser(ctx.id, username)
    ctx.broadcast('user:joined', { username })
  }

  @OnDisconnect()
  handleDisconnect(ctx: WsContext) {
    const username = ctx.get<string>('username') ?? ctx.id
    this.chatService.removeUser(ctx.id)
    ctx.broadcast('user:left', { username })
  }

  @OnMessage('chat:send')
  handleSend(ctx: WsContext) {
    const username = ctx.get<string>('username') ?? ctx.id
    const message = {
      from: username,
      text: ctx.data.text,
      timestamp: new Date().toISOString(),
    }
    this.chatService.addMessage(message)
    ctx.broadcastAll('chat:message', message)
  }

  @OnMessage('chat:history')
  handleHistory(ctx: WsContext) {
    ctx.send('chat:history', {
      messages: this.chatService.getMessages(),
    })
  }

  @OnMessage('room:join')
  handleRoomJoin(ctx: WsContext) {
    const room = ctx.data.room
    ctx.join(room)
    const username = ctx.get<string>('username') ?? ctx.id
    ctx.send('room:joined', { room })
    ctx.to(room).send('room:user-joined', { username, room })
  }

  @OnMessage('room:message')
  handleRoomMessage(ctx: WsContext) {
    const username = ctx.get<string>('username') ?? ctx.id
    ctx.to(ctx.data.room).send('room:message', {
      from: username,
      text: ctx.data.text,
      room: ctx.data.room,
      timestamp: new Date().toISOString(),
    })
  }

  @OnMessage('room:leave')
  handleRoomLeave(ctx: WsContext) {
    const room = ctx.data.room
    const username = ctx.get<string>('username') ?? ctx.id
    ctx.to(room).send('room:user-left', { username, room })
    ctx.leave(room)
    ctx.send('room:left', { room })
  }

  @OnMessage('user:rename')
  handleRename(ctx: WsContext) {
    const oldName = ctx.get<string>('username') ?? ctx.id
    const newName = ctx.data.username
    ctx.set('username', newName)
    this.chatService.renameUser(ctx.id, newName)
    ctx.broadcastAll('user:renamed', { oldName, newName })
  }

  @OnMessage('*')
  handleUnknown(ctx: WsContext) {
    ctx.send('error', { message: `Unknown event: ${ctx.event}` })
  }

  @OnError()
  handleError(ctx: WsContext) {
    ctx.send('error', { message: ctx.data?.message ?? 'Unknown error' })
  }
}
