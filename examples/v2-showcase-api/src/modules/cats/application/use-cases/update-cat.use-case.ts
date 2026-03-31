import { Service, Inject } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../../domain/repositories/cat.repository'
import type { UpdateCatDTO } from '../dtos/update-cat.dto'
import type { CatResponseDTO } from '../dtos/cat-response.dto'

@Service()
export class UpdateCatUseCase {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async execute(id: string, dto: UpdateCatDTO): Promise<CatResponseDTO> {
    return this.repo.update(id, dto)
  }
}
