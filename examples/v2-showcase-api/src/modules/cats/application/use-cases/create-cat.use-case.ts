/**
 * Create Cat Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs'
import { CAT_REPOSITORY, type ICatRepository } from '../../domain/repositories/cat.repository'
import type { CreateCatDTO } from '../dtos/create-cat.dto'
import type { CatResponseDTO } from '../dtos/cat-response.dto'

@Service()
export class CreateCatUseCase {
  constructor(
    @Inject(CAT_REPOSITORY) private readonly repo: ICatRepository,
  ) {}

  async execute(dto: CreateCatDTO): Promise<CatResponseDTO> {
    return this.repo.create(dto)
  }
}
