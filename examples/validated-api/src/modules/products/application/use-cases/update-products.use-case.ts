import { Service, Inject } from '@kickjs/core'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'
import type { UpdateProductsDTO } from '../dtos/update-products.dto'
import type { ProductsResponseDTO } from '../dtos/products-response.dto'

@Service()
export class UpdateProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(id: string, dto: UpdateProductsDTO): Promise<ProductsResponseDTO> {
    return this.repo.update(id, dto)
  }
}
