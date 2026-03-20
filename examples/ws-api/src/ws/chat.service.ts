import { Service } from '@forinda/kickjs-core'

interface ChatMessage {
  from: string
  text: string
  timestamp: string
}

@Service()
export class ChatService {
  private messages: ChatMessage[] = []
  private users = new Map<string, string>()
  private readonly maxHistory = 100

  addMessage(message: ChatMessage): void {
    this.messages.push(message)
    if (this.messages.length > this.maxHistory) {
      this.messages.shift()
    }
  }

  getMessages(): ChatMessage[] {
    return [...this.messages]
  }

  addUser(id: string, username: string): void {
    this.users.set(id, username)
  }

  removeUser(id: string): void {
    this.users.delete(id)
  }

  renameUser(id: string, newName: string): void {
    this.users.set(id, newName)
  }

  getOnlineCount(): number {
    return this.users.size
  }

  getOnlineUsers(): string[] {
    return Array.from(this.users.values())
  }
}
