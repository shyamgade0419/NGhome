/**
 * GET /health/storage must never fail the way GET /health can — a transient
 * SFTP outage should read as "storage is down", not "the API is down"
 * (Coolify's container healthcheck polls /health, not /health/storage).
 */

import { HealthController, DatabaseHealthIndicator } from './health.controller';
import { HealthCheckService } from '@nestjs/terminus';
import { SftpStorageService } from '../documents/sftp-storage.service';

function makeController(checkStorageResult: unknown) {
  const storage = { checkStorage: jest.fn().mockResolvedValue(checkStorageResult) } as unknown as SftpStorageService;
  const controller = new HealthController(
    {} as unknown as HealthCheckService,
    {} as unknown as DatabaseHealthIndicator,
    storage,
  );
  return { controller, storage };
}

describe('HealthController.storageStatus', () => {
  it('reports ok with the configured base path when storage is reachable', async () => {
    const { controller } = makeController({ ok: true, home: '/home/naafashions.in', base: 'apartment-management' });
    await expect(controller.storageStatus()).resolves.toEqual({
      status: 'ok',
      provider: 'sftp',
      base: 'apartment-management',
    });
  });

  it('reports error with a human-readable reason when storage is unreachable', async () => {
    const { controller } = makeController({ ok: false, reason: 'could not log in — timed out' });
    await expect(controller.storageStatus()).resolves.toEqual({
      status: 'error',
      provider: 'sftp',
      reason: 'could not log in — timed out',
    });
  });

  it('never includes a home directory, private key, or password in the response', async () => {
    const { controller } = makeController({
      ok: false,
      reason: 'cannot write — permission denied',
      home: '/home/naafashions.in',
    });
    const result = (await controller.storageStatus()) as Record<string, unknown>;
    expect(JSON.stringify(result)).not.toContain('naafashions.in');
    expect(result.home).toBeUndefined();
  });
});
