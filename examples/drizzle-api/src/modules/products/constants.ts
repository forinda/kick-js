import type { DrizzleQueryParamsConfig } from '@forinda/kickjs-drizzle'
import { products } from '@/db/schema'

export const PRODUCTS_QUERY_CONFIG: DrizzleQueryParamsConfig = {
  columns: {
    name: products.name,
    category: products.category,
    price: products.price,
    stock: products.stock,
  },
  sortable: {
    name: products.name,
    price: products.price,
    createdAt: products.createdAt,
  },
  searchColumns: [products.name, products.description, products.category],
}
