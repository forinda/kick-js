import { Service, Inject } from '@forinda/kickjs'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'
import type { ProductsResponseDTO } from '../dtos/products-response.dto'

@Service()
export class ListProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(): Promise<ProductsResponseDTO[]> {
    return this.repo.findAll()
  }
}
