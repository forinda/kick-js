/**
 * Create Products Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'
import type { CreateProductsDTO } from '../dtos/create-products.dto'
import type { ProductsResponseDTO } from '../dtos/products-response.dto'

@Service()
export class CreateProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(dto: CreateProductsDTO): Promise<ProductsResponseDTO> {
    return this.repo.create(dto)
  }
}
