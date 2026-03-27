/**
 * Create Health Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../../domain/repositories/health.repository'
import type { CreateHealthDTO } from '../dtos/create-health.dto'
import type { HealthResponseDTO } from '../dtos/health-response.dto'

@Service()
export class CreateHealthUseCase {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async execute(dto: CreateHealthDTO): Promise<HealthResponseDTO> {
    return this.repo.create(dto)
  }
}
