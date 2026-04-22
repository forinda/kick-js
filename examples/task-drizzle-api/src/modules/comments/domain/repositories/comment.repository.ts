import type { comments } from '@/db/schema'
import type { ParsedQuery } from '@forinda/kickjs'

export type Comment = typeof comments.$inferSelect
export type NewComment = typeof comments.$inferInsert

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
