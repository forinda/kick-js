import { Service, Inject, HttpException } from '@kickjs/core'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../repositories/products.repository'

@Service()
export class ProductsDomainService {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Product not found')
    }
  }
}
