import { Service, Inject } from '@forinda/kickjs-core'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'

@Service()
export class GetCommentUseCase {
  constructor(@Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
