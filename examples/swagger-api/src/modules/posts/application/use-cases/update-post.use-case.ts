import { Service, Inject } from '@forinda/kickjs-core'
import { POST_REPOSITORY, type IPostRepository } from '../../domain/repositories/post.repository'
import type { UpdatePostDTO } from '../dtos/update-post.dto'
import type { PostResponseDTO } from '../dtos/post-response.dto'

@Service()
export class UpdatePostUseCase {
  constructor(
    @Inject(POST_REPOSITORY) private readonly repo: IPostRepository,
  ) {}

  async execute(id: string, dto: UpdatePostDTO): Promise<PostResponseDTO> {
    return this.repo.update(id, dto)
  }
}
