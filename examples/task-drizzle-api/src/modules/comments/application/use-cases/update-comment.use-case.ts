import { Service, Inject } from '@forinda/kickjs'
import {
  COMMENT_REPOSITORY,
  type ICommentRepository,
} from '../../domain/repositories/comment.repository'
import type { UpdateCommentDTO } from '../dtos/update-comment.dto'

/** Extract @mentioned user IDs from comment content */
function parseMentions(content: string): string[] {
  const uuidRegex = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
  const matches = content.matchAll(uuidRegex)
  return [...new Set([...matches].map((m) => m[1]))]
}

@Service()
export class UpdateCommentUseCase {
  constructor(@Inject(COMMENT_REPOSITORY) private readonly repo: ICommentRepository) {}

  async execute(id: string, dto: UpdateCommentDTO) {
    const mentions = parseMentions(dto.content)
    return this.repo.update(id, { content: dto.content, mentions })
  }
}
