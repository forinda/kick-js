import { Service, Inject } from '@forinda/kickjs-core'
import { POST_REPOSITORY, type IPostRepository } from '../../domain/repositories/post.repository'
import type { PostResponseDTO } from '../dtos/post-response.dto'

@Service()
export class ListPostsUseCase {
  constructor(
    @Inject(POST_REPOSITORY) private readonly repo: IPostRepository,
  ) {}

  async execute(): Promise<PostResponseDTO[]> {
    return this.repo.findAll()
  }
}
