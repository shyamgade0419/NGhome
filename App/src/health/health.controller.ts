import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { PlatformAdminGuard } from '../common/guards/platform-admin.guard';
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
  // env vars are set.
  //
  // Public, but deliberately thin and rate-limited: checkStorage() opens a
  // real SFTP connection and does a write+delete round trip, so an
  // unthrottled public endpoint would let anyone hammer ServerByt for free
  // just by polling this. The public body is intentionally just ok/error —
  // checkStorage()'s failure `reason` can include the account's actual home
  // directory path (the remediation hint suggests a corrected
  // SFTP_BASE_PATH using it), which has no business being visible to an
  // unauthenticated caller. The full reason is available to a platform
  // admin below.
  @Get('storage')
  @Public()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'SFTP storage connectivity (ok/error only) — does not affect overall health status' })
  async storageStatus() {
    const result = await this.storage.checkStorage();
    return { status: result.ok ? 'ok' : 'error', provider: 'sftp' };
  }

  // The detailed version of the same probe — base path and, on failure, the
  // actual reason (which may include the SFTP account's home directory) —
  // for whoever is actually debugging a storage outage. Platform-admin
  // only, same throttle: this still opens a real SFTP connection.
  @Get('storage/detail')
  @UseGuards(PlatformAdminGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'SFTP storage connectivity, full diagnostic detail — platform admin only' })
  async storageStatusDetail() {
    const result = await this.storage.checkStorage();
    return result.ok
      ? { status: 'ok', provider: 'sftp', base: result.base }
      : { status: 'error', provider: 'sftp', reason: result.reason };
  }
}
