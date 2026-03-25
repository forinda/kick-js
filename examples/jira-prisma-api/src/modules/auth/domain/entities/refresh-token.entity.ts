export interface RefreshTokenEntity {
  id: string
  userId: string
  token: string
  expiresAt: Date
  createdAt: Date
}
