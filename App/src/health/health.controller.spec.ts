/**
 * GET /health/storage must never fail the way GET /health can — a transient
 * SFTP outage should read as "storage is down", not "the API is down"
 * (Coolify's container healthcheck polls /health, not /health/storage).
 *
 * GET /health/storage is public and rate-limited (checkStorage() opens a
 * real SFTP connection and does a write+delete round trip — unthrottled,
 * anyone could use it to hammer ServerByt for free) and deliberately thin:
 * checkStorage()'s failure `reason` can name the SFTP account's actual home
 * directory, which an unauthenticated caller has no business seeing. The
 * full diagnostic lives at GET /health/storage/detail, platform-admin only.
 */

import { HealthController, DatabaseHealthIndicator } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { SftpStorageService } from '../documents/sftp-storage.service';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';

function makeController(checkStorageResult: unknown) {
  const storage = { checkStorage: jest.fn().mockResolvedValue(checkStorageResult) } as unknown as SftpStorageService;
  const controller = new HealthController(
    {} as unknown as HealthCheckService,
    {} as unknown as DatabaseHealthIndicator,
    storage,
  );
  return { controller, storage };
}

describe('HealthController.storageStatus — the public view', () => {
  it('reports ok, without the base path, when storage is reachable', async () => {
    const { controller } = makeController({ ok: true, home: '/home/naafashions.in', base: 'apartment-management' });
    await expect(controller.storageStatus()).resolves.toEqual({ status: 'ok', provider: 'sftp' });
  });

  it('reports error, without the reason, when storage is unreachable', async () => {
    const { controller } = makeController({ ok: false, reason: 'could not log in — timed out' });
    await expect(controller.storageStatus()).resolves.toEqual({ status: 'error', provider: 'sftp' });
  });

  it('never includes a home directory, base path, reason, private key, or password in the public response', async () => {
    const { controller } = makeController({
      ok: false,
      reason: 'cannot write — permission denied. The account home is /home/naafashions.in — try SFTP_BASE_PATH=...',
      home: '/home/naafashions.in',
      base: 'apartment-management',
    });
    const result = (await controller.storageStatus()) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain('naafashions.in');
    expect(result).toEqual({ status: 'error', provider: 'sftp' });
  });

  it('is rate-limited well below the global default (100/min) — this triggers a real SFTP round trip', () => {
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', HealthController.prototype.storageStatus);
    expect(limit).toBeLessThanOrEqual(10);
  });
});

describe('HealthController.storageStatusDetail — the platform-admin view', () => {
  it('reports the base path when storage is reachable', async () => {
    const { controller } = makeController({ ok: true, home: '/home/naafashions.in', base: 'apartment-management' });
    await expect(controller.storageStatusDetail()).resolves.toEqual({
      status: 'ok',
      provider: 'sftp',
      base: 'apartment-management',
    });
  });

  it('reports the human-readable reason when storage is unreachable', async () => {
    const { controller } = makeController({ ok: false, reason: 'could not log in — timed out' });
    await expect(controller.storageStatusDetail()).resolves.toEqual({
      status: 'error',
      provider: 'sftp',
      reason: 'could not log in — timed out',
    });
  });

  it('never includes the private key or password, even in the detailed view', async () => {
    const { controller } = makeController({ ok: false, reason: 'cannot write — permission denied' });
    const result = (await controller.storageStatusDetail()) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toMatch(/private.?key|password/i);
  });

  it('requires PlatformAdminGuard, not @Public()', () => {
    const guards = Reflect.getMetadata('__guards__', HealthController.prototype.storageStatusDetail);
    expect(guards).toBeDefined();
    const isPublic = Reflect.getMetadata('isPublic', HealthController.prototype.storageStatusDetail);
    expect(isPublic).not.toBe(true);
  });

  it('is rate-limited the same as the public view — this also triggers a real SFTP round trip', () => {
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', HealthController.prototype.storageStatusDetail);
    expect(limit).toBeLessThanOrEqual(10);
  });
});
