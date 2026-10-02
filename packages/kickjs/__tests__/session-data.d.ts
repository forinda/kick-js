// SessionData keys for session-types.test.ts — the augmentation an app writes.
export {}

declare module '@forinda/kickjs' {
  interface SessionData {
    userId?: string
    role?: 'admin' | 'member'
  }
}
