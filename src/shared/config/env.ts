import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  MIGRATE_ON_STARTUP: bool.default('true'),
  WORKERS_ENABLED: bool.default('true'),
  SIMULATE_PROVIDER: bool.default('false'),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  BACKOFF_BASE_MS: z.coerce.number().int().nonnegative().default(1000),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('Env');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment (see .env.example): ${parsed.error.message}`);
  }
  return parsed.data;
}
