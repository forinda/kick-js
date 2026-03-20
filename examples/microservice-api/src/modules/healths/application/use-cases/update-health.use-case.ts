import { Service, Inject } from '@forinda/kickjs-core'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../../domain/repositories/health.repository'
import type { UpdateHealthDTO } from '../dtos/update-health.dto'
import type { HealthResponseDTO } from '../dtos/health-response.dto'

@Service()
export class UpdateHealthUseCase {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async execute(id: string, dto: UpdateHealthDTO): Promise<HealthResponseDTO> {
    return this.repo.update(id, dto)
  }
}
