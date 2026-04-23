import { defineEnv, loadEnv } from '@forinda/kickjs'
import { z } from 'zod'

const envSchema = defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    APP_URL: z.string().default('http://localhost:3000'),
    APP_NAME: z.string().default('Vibed'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    RESEND_API_KEY: z.string().default(''),
    MAIL_FROM_NAME: z.string().default('Vibed'),
    MAIL_FROM_EMAIL: z.string().default('noreply@vibed.dev'),
  }),
)

export const env = loadEnv(envSchema)
export type Env = typeof env
