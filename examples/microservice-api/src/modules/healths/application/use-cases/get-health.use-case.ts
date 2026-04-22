import { Service, Inject } from '@forinda/kickjs'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../../domain/repositories/health.repository'
import type { HealthResponseDTO } from '../dtos/health-response.dto'

@Service()
export class GetHealthUseCase {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async execute(id: string): Promise<HealthResponseDTO | null> {
    return this.repo.findById(id)
  }
}
