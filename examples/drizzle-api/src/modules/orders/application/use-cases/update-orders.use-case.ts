import { Service, Inject } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../../domain/repositories/orders.repository'
import type { UpdateOrdersDTO } from '../dtos/update-orders.dto'
import type { OrdersResponseDTO } from '../dtos/orders-response.dto'

@Service()
export class UpdateOrdersUseCase {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async execute(id: string, dto: UpdateOrdersDTO): Promise<OrdersResponseDTO> {
    return this.repo.update(id, dto)
  }
}
