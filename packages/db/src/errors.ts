export class KickDbError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = this.constructor.name
    this.code = code
  }
}
