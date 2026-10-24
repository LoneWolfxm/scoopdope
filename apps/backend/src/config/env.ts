import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  // Database connection pool settings
  DB_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(5000),

  // Exchange rate API key used for instructor payout currency conversion
  EXCHANGE_RATE_API_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${errors}`);
  }

  return parsed.data;
}

export const env = loadEnv();