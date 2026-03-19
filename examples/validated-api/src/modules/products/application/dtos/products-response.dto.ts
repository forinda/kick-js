export interface ProductsResponseDTO {
  id: string
  name: string
  description?: string
  price: number
  category: string
  status: string
  tags: string[]
  sku?: string
  stock: number
  createdAt: string
  updatedAt: string
}
