import { Service, Inject } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../../domain/repositories/orders.repository'
import type { OrdersResponseDTO } from '../dtos/orders-response.dto'

@Service()
export class GetOrdersUseCase {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async execute(id: string): Promise<OrdersResponseDTO | null> {
    return this.repo.findById(id)
  }
}
