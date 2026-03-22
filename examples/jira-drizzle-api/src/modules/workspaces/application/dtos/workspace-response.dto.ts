export interface WorkspaceResponseDTO {
  id: string
  name: string
  slug: string
  description: string | null
  ownerId: string
  logoUrl: string | null
  createdAt: Date
  updatedAt: Date
}
