import { Service, Inject } from '@forinda/kickjs'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../../domain/repositories/health.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListHealthsUseCase {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async execute(parsed: ParsedQuery) {
    return this.repo.findPaginated(parsed)
  }
}
