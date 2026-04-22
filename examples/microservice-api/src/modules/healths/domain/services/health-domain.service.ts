/**
 * Health Domain Service
 *
 * Domain layer — contains business rules that don't belong to a single entity.
 * Use this for cross-entity logic, validation rules, and domain invariants.
 * Keep it free of HTTP/framework concerns.
 */
import { Service, Inject, HttpException } from '@forinda/kickjs'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../repositories/health.repository'

@Service()
export class HealthDomainService {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Health not found')
    }
  }
}
