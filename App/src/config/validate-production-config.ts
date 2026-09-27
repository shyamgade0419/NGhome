import { ConfigService } from '@nestjs/config';

const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Fails the boot with a clear error rather than let a production deployment
 * come up misconfigured and fail silently later — a bad JWT secret would
 * otherwise only surface the first time someone tries to log in, and a bad
 * storage setup would only surface the first time someone uploads a file.
 *
 * Kept as a plain function (not inline in main.ts's bootstrap()) so it can
 * be unit tested without booting a real Nest application.
 */
export function validateProductionConfig(configService: ConfigService): void {
  const nodeEnv = configService.get<string>('nodeEnv') ?? 'development';
  if (nodeEnv !== 'production') return;

  const accessSecret = configService.get<string>('jwt.accessSecret');
  const refreshSecret = configService.get<string>('jwt.refreshSecret');
  const insecureDefaults = ['default-access-secret', 'default-refresh-secret'];
  if (!accessSecret || insecureDefaults.includes(accessSecret)) {
    throw new Error('FATAL: JWT_ACCESS_SECRET must be set to a secure value in production');
  }
  if (!refreshSecret || insecureDefaults.includes(refreshSecret)) {
    throw new Error('FATAL: JWT_REFRESH_SECRET must be set to a secure value in production');
  }
  // The insecure-default list above only catches the two built-in fallbacks.
  // Nothing stopped the .env.example placeholder ("<run: openssl rand -hex
  // 32>") or a short guessable string being deployed as-is — the app would
  // boot and sign every login token with a value that is public or trivial
  // to brute-force, letting anyone forge one, platform admin included.
  for (const [name, secret] of [
    ['JWT_ACCESS_SECRET', accessSecret],
    ['JWT_REFRESH_SECRET', refreshSecret],
  ] as const) {
    if (/[<>]/.test(secret)) {
      throw new Error(
        `FATAL: ${name} still contains the .env.example placeholder text — generate a real value with: openssl rand -hex 32`,
      );
    }
    if (secret.length < MIN_JWT_SECRET_LENGTH) {
      throw new Error(
        `FATAL: ${name} must be at least ${MIN_JWT_SECRET_LENGTH} characters in production (got ${secret.length}) — generate one with: openssl rand -hex 32`,
      );
    }
  }
  if (accessSecret === refreshSecret) {
    throw new Error(
      'FATAL: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ — a leaked access token secret would otherwise also forge refresh tokens',
    );
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('FATAL: DATABASE_URL must be set in production');
  }

  // Storage must fail closed: STORAGE_PROVIDER defaults to 'local' for local
  // development (App/.env.example), and nothing here should let that default
  // quietly reach a production deployment. This is a config-correctness
  // check, separate from and in addition to SftpStorageService's own
  // non-blocking, best-effort live connectivity check at boot (checkStorage
  // in sftp-storage.service.ts) — that one probes whether the configured
  // server is actually reachable and writable; this one only confirms the
  // configuration itself is the production shape before anything connects.
  const provider = configService.get<string>('storage.provider');
  if (provider !== 'sftp') {
    throw new Error(
      `FATAL: STORAGE_PROVIDER must be "sftp" in production (got ${JSON.stringify(provider)}). ` +
        'Local filesystem storage is for development only and is not persisted in production.',
    );
  }

  const host = configService.get<string>('storage.sftp.host');
  const username = configService.get<string>('storage.sftp.username');
  const basePath = configService.get<string>('storage.sftp.basePath');
  const privateKey = configService.get<string>('storage.sftp.privateKey');
  // Password auth stays available for local development (see
  // SftpStorageService.getConnectOptions) — production must use the ED25519
  // key regardless of whether a password is also set, never fall back to it.
  const password = configService.get<string>('storage.sftp.password');

  if (!host) throw new Error('FATAL: SFTP_HOST must be set in production');
  if (!username) throw new Error('FATAL: SFTP_USERNAME must be set in production');
  if (!basePath) throw new Error('FATAL: SFTP_BASE_PATH must be set in production');
  if (!privateKey) {
    throw new Error(
      'FATAL: SFTP_PRIVATE_KEY must be set in production — password authentication ' +
        `(SFTP_PASSWORD${password ? ', which is set' : ''}) is not accepted for production storage.`,
    );
  }
}
