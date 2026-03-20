import { Service, Inject } from '@forinda/kickjs-core'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'
import type { ProductsResponseDTO } from '../dtos/products-response.dto'

@Service()
export class GetProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(id: string): Promise<ProductsResponseDTO | null> {
    return this.repo.findById(id)
  }
}
