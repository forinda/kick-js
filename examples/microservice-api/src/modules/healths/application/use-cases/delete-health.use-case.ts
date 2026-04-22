import { Service, Inject } from '@forinda/kickjs'
import { HEALTH_REPOSITORY, type IHealthRepository } from '../../domain/repositories/health.repository'

@Service()
export class DeleteHealthUseCase {
  constructor(
    @Inject(HEALTH_REPOSITORY) private readonly repo: IHealthRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
