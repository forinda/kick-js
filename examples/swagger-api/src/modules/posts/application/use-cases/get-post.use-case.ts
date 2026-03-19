import { Service, Inject } from '@kickjs/core'
import { POST_REPOSITORY, type IPostRepository } from '../../domain/repositories/post.repository'
import type { PostResponseDTO } from '../dtos/post-response.dto'

@Service()
export class GetPostUseCase {
  constructor(
    @Inject(POST_REPOSITORY) private readonly repo: IPostRepository,
  ) {}

  async execute(id: string): Promise<PostResponseDTO | null> {
    return this.repo.findById(id)
  }
}
