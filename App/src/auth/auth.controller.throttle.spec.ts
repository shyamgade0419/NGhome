/**
 * The global throttle (100 req/min/IP — app.module.ts) is shared by every
 * endpoint and was never meant to be brute-force protection on its own.
 * These pin that the auth-sensitive routes actually carry their own
 * tighter @Throttle() override on the 'default' throttler, rather than
 * relying on a decorator that's easy to silently lose in a future edit.
 *
 * A full end-to-end throttling test (real HTTP requests hitting the actual
 * limit) needs a running app + database, which this test suite doesn't
 * have — this checks the metadata ThrottlerGuard itself reads, the same
 * mechanism @nestjs/throttler's own tests use.
 */

import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { AuthController } from './auth.controller';

function throttleFor(methodName: keyof AuthController) {
  const method = (AuthController.prototype as any)[methodName];
  return {
    limit: Reflect.getMetadata(THROTTLER_LIMIT + 'default', method),
    ttl: Reflect.getMetadata(THROTTLER_TTL + 'default', method),
  };
}

describe('AuthController — auth-sensitive routes carry a tighter throttle than the global default', () => {
  it.each([
    ['login', 10],
    ['registerSociety', 5],
    ['joinSociety', 5],
    ['forgotPassword', 3],
    ['resetPassword', 5],
    ['refresh', 20],
  ])('%s is limited to %d requests per window, well under the global 100/min', (method, expectedLimit) => {
    const { limit, ttl } = throttleFor(method as keyof AuthController);
    expect(limit).toBe(expectedLimit);
    expect(limit).toBeLessThan(100);
    expect(ttl).toBe(60_000);
  });
});
