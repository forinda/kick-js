import type { ParsedQuery } from '@forinda/kickjs-http'
import type { Comment } from '@prisma/client'

export type { Comment }
export type NewComment = {
  taskId: string
  authorId: string
  content: string
  mentions?: any
}

export interface ICommentRepository {
  findById(id: string): Promise<Comment | null>
  findByTask(taskId: string): Promise<Comment[]>
  findPaginated(parsed: ParsedQuery, taskId?: string): Promise<{ data: Comment[]; total: number }>
  create(data: NewComment): Promise<Comment>
  update(id: string, data: Partial<NewComment>): Promise<Comment>
  delete(id: string): Promise<void>
  countByTask(taskId: string): Promise<number>
}

export const COMMENT_REPOSITORY = Symbol('ICommentRepository')
