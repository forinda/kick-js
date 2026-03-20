/**
 * Products Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { ProductsResponseDTO } from '../../application/dtos/products-response.dto'
import type { CreateProductsDTO } from '../../application/dtos/create-products.dto'
import type { UpdateProductsDTO } from '../../application/dtos/update-products.dto'

export interface IProductsRepository {
  findById(id: string): Promise<ProductsResponseDTO | null>
  findAll(): Promise<ProductsResponseDTO[]>
  create(dto: CreateProductsDTO): Promise<ProductsResponseDTO>
  update(id: string, dto: UpdateProductsDTO): Promise<ProductsResponseDTO>
  delete(id: string): Promise<void>
}

export const PRODUCTS_REPOSITORY = Symbol('IProductsRepository')
