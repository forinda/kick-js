/**
 * Orders Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { OrdersResponseDTO } from '../../application/dtos/orders-response.dto'
import type { CreateOrdersDTO } from '../../application/dtos/create-orders.dto'
import type { UpdateOrdersDTO } from '../../application/dtos/update-orders.dto'

export interface IOrdersRepository {
  findById(id: string): Promise<OrdersResponseDTO | null>
  findAll(): Promise<OrdersResponseDTO[]>
  create(dto: CreateOrdersDTO): Promise<OrdersResponseDTO>
  update(id: string, dto: UpdateOrdersDTO): Promise<OrdersResponseDTO>
  delete(id: string): Promise<void>
}

export const ORDERS_REPOSITORY = Symbol('IOrdersRepository')
