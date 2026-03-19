import { Service, Inject } from '@kickjs/core'
import { POST_REPOSITORY, type IPostRepository } from '../../domain/repositories/post.repository'

@Service()
export class DeletePostUseCase {
  constructor(
    @Inject(POST_REPOSITORY) private readonly repo: IPostRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
