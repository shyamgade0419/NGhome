import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { SftpStorageService } from '../documents/sftp-storage.service';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true, { message: 'Database is reachable' });
    } catch (error) {
      return this.getStatus(key, false, {
        message: error instanceof Error ? error.message : 'Database unreachable',
      });
    }
  }
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dbIndicator: DatabaseHealthIndicator,
    private readonly storage: SftpStorageService,
  ) {}

  // Deliberately DB-only: this is what Coolify's container healthcheck polls
  // (Dockerfile: `wget http://localhost:3000/health`), so a 503 here rolls
  // the deployment back. SFTP is checked separately below — the core API
  // (auth, billing, everything that isn't file storage) works fine with
  // SFTP down, so a transient storage outage must not read as "the API is
  // down" and trigger a rollback over a problem that only affects uploads.
  @Get()
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Application and database health check' })
  check() {
    return this.health.check([
      () => this.dbIndicator.isHealthy('database'),
    ]);
  }

  // Informational, not wired into the HealthCheck() above on purpose (see
  // above) — always 200, the body itself says ok/error. Reuses
  // SftpStorageService.checkStorage(), the same probe the boot log already
  // runs, so this reflects real connect+write capability, not just whether
  // env vars are set. Never returns the private key or password — only what
  // checkStorage() itself already returns (ok, home, base, or a
  // human-readable reason with no credential material in it).
  @Get('storage')
  @Public()
  @ApiOperation({ summary: 'SFTP storage connectivity — informational, does not affect overall health status' })
  async storageStatus() {
    const result = await this.storage.checkStorage();
    return result.ok
      ? { status: 'ok', provider: 'sftp', base: result.base }
      : { status: 'error', provider: 'sftp', reason: result.reason };
  }
}
