import { Service, Inject } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../../domain/repositories/cat.repository'
import type { CatResponseDTO } from '../dtos/cat-response.dto'

@Service()
export class GetCatUseCase {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async execute(id: string): Promise<CatResponseDTO | null> {
    return this.repo.findById(id)
  }
}
