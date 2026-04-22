import { z } from 'zod';
import { defineEnv, loadEnv } from '@forinda/kickjs-config';

const envSchema = defineEnv((base) =>
  base.extend({
    MONGODB_URI: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    RESEND_API_KEY: z.string().min(1),
    MAIL_FROM_NAME: z.string().default('Vibed'),
    MAIL_FROM_EMAIL: z.string().email(),
    APP_URL: z.string().url(),
    APP_NAME: z.string().default('Vibed'),
  }),
);

export const env = loadEnv(envSchema);
export type Env = typeof env;
