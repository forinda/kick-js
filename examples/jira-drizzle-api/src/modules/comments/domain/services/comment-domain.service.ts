import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { COMMENT_REPOSITORY, type ICommentRepository } from '../repositories/comment.repository'

@Service()
export class CommentDomainService {
  constructor(@Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Comment not found')
    }
    return entity
  }
}
