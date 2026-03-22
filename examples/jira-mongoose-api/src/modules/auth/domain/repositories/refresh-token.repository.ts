export interface IRefreshTokenRepository {
  create(data: { userId: string; token: string; expiresAt: Date }): Promise<any>;
  findByToken(token: string): Promise<any | null>;
  deleteByToken(token: string): Promise<boolean>;
  deleteByUserId(userId: string): Promise<void>;
  deleteExpired(): Promise<number>;
}
