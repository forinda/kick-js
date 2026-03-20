import { Service, Inject } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../../domain/repositories/orders.repository'

@Service()
export class DeleteOrdersUseCase {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
