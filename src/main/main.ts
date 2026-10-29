import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { runMigrations } from '../infra/database/migrate';
import { loadEnv } from '../shared/config/env';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = new Logger('Bootstrap');

  if (env.MIGRATE_ON_STARTUP) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    try {
      const applied = await runMigrations(pool);
      if (applied.length) logger.log(`Applied migrations: ${applied.join(', ')}`);
    } finally {
      await pool.end();
    }
  }

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  logger.log(
    `API listening on port ${env.PORT} (workers=${env.WORKERS_ENABLED}, fake provider=${env.SIMULATE_PROVIDER}).`,
  );
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
