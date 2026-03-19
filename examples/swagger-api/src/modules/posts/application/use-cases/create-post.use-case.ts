/**
 * Create Post Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { POST_REPOSITORY, type IPostRepository } from '../../domain/repositories/post.repository'
import type { CreatePostDTO } from '../dtos/create-post.dto'
import type { PostResponseDTO } from '../dtos/post-response.dto'

@Service()
export class CreatePostUseCase {
  constructor(
    @Inject(POST_REPOSITORY) private readonly repo: IPostRepository,
  ) {}

  async execute(dto: CreatePostDTO): Promise<PostResponseDTO> {
    return this.repo.create(dto)
  }
}
