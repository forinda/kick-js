/**
 * Create Orders Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { ORDERS_REPOSITORY, type IOrdersRepository } from '../../domain/repositories/orders.repository'
import type { CreateOrdersDTO } from '../dtos/create-orders.dto'
import type { OrdersResponseDTO } from '../dtos/orders-response.dto'

@Service()
export class CreateOrdersUseCase {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: IOrdersRepository,
  ) {}

  async execute(dto: CreateOrdersDTO): Promise<OrdersResponseDTO> {
    return this.repo.create(dto)
  }
}
