import { Service, Inject } from '@forinda/kickjs'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListCommentsUseCase {
  constructor(@Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository) {}

  async execute(parsed: ParsedQuery, taskId?: string) {
    return this.repo.findPaginated(parsed, taskId)
  }
}
