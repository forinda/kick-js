import { Service, Inject } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../../domain/repositories/orders.repository'
import type { OrdersResponseDTO } from '../dtos/orders-response.dto'

@Service()
export class ListOrdersUseCase {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async execute(): Promise<OrdersResponseDTO[]> {
    return this.repo.findAll()
  }
}
