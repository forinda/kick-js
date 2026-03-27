import { Service, Inject } from '@forinda/kickjs-core'
import { PRODUCTS_REPOSITORY, type IProductsRepository } from '../../domain/repositories/products.repository'

@Service()
export class DeleteProductsUseCase {
  constructor(
    @Inject(PRODUCTS_REPOSITORY) private readonly repo: IProductsRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
