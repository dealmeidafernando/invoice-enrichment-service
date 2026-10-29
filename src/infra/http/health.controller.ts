import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Database } from '../database/database';

@Controller('health')
export class HealthController {
  constructor(private readonly db: Database) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'unavailable' });
    }
  }
}
