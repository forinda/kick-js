import { Service, Inject } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../../domain/repositories/cat.repository'

@Service()
export class DeleteCatUseCase {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
