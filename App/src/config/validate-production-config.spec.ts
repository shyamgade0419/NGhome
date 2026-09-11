/**
 * Production must fail to boot rather than come up with an insecure secret
 * or storage silently pointed at the local filesystem — either would
 * otherwise only surface the first time someone actually hits the affected
 * feature. Development/test environments are untouched (see the "does
 * nothing outside production" tests).
 */

import { ConfigService } from '@nestjs/config';
import { validateProductionConfig } from './validate-production-config';

const VALID: Record<string, unknown> = {
  nodeEnv: 'production',
  'jwt.accessSecret': 'a'.repeat(32),
  'jwt.refreshSecret': 'b'.repeat(32),
  'storage.provider': 'sftp',
  'storage.sftp.host': 'ssh.gb.stackcp.com',
  'storage.sftp.username': 'naafashions.in',
  'storage.sftp.basePath': 'apartment-management',
  'storage.sftp.privateKey': '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----\n',
};

function configWith(overrides: Record<string, unknown>): ConfigService {
  const values = { ...VALID, ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

// DATABASE_URL is read from the real process.env (not the mocked
// ConfigService, to exercise the exact same check main.ts runs) — every
// other test in this file needs it set so its own assertion isn't masked by
// the unrelated "DATABASE_URL missing" error.
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});
afterAll(() => {
  if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('validateProductionConfig — outside production', () => {
  it.each(['development', 'test', undefined])('does nothing when nodeEnv is %s', (nodeEnv) => {
    const config = configWith({ nodeEnv, 'jwt.accessSecret': undefined, 'storage.provider': 'local' });
    expect(() => validateProductionConfig(config)).not.toThrow();
  });
});

describe('validateProductionConfig — a fully valid production config', () => {
  it('does not throw', () => {
    expect(() => validateProductionConfig(configWith({}))).not.toThrow();
  });

  it('still passes when SFTP_PASSWORD happens to also be set alongside the key', () => {
    expect(() => validateProductionConfig(configWith({ 'storage.sftp.password': 'also-set' }))).not.toThrow();
  });
});

describe('validateProductionConfig — secrets', () => {
  it('rejects a missing access secret', () => {
    expect(() => validateProductionConfig(configWith({ 'jwt.accessSecret': undefined }))).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects the insecure default access secret', () => {
    expect(() => validateProductionConfig(configWith({ 'jwt.accessSecret': 'default-access-secret' }))).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects a missing refresh secret', () => {
    expect(() => validateProductionConfig(configWith({ 'jwt.refreshSecret': undefined }))).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    delete process.env.DATABASE_URL; // beforeEach sets it; afterAll restores the real value
    expect(() => validateProductionConfig(configWith({}))).toThrow(/DATABASE_URL/);
  });
});

describe('validateProductionConfig — storage must fail closed', () => {
  it.each(['local', undefined, '', 'LOCAL', 's3'])('rejects STORAGE_PROVIDER=%j', (provider) => {
    expect(() => validateProductionConfig(configWith({ 'storage.provider': provider }))).toThrow(
      /STORAGE_PROVIDER must be "sftp"/,
    );
  });

  it('rejects a missing SFTP_HOST', () => {
    expect(() => validateProductionConfig(configWith({ 'storage.sftp.host': undefined }))).toThrow(/SFTP_HOST/);
  });

  it('rejects a missing SFTP_USERNAME', () => {
    expect(() => validateProductionConfig(configWith({ 'storage.sftp.username': undefined }))).toThrow(
      /SFTP_USERNAME/,
    );
  });

  it('rejects a missing SFTP_BASE_PATH', () => {
    expect(() => validateProductionConfig(configWith({ 'storage.sftp.basePath': undefined }))).toThrow(
      /SFTP_BASE_PATH/,
    );
  });

  it('rejects a missing private key even when a password is configured — production never falls back to password auth', () => {
    expect(() =>
      validateProductionConfig(
        configWith({ 'storage.sftp.privateKey': undefined, 'storage.sftp.password': 'letmein' }),
      ),
    ).toThrow(/SFTP_PRIVATE_KEY/);
  });

  it('rejects a missing private key with no password either', () => {
    expect(() => validateProductionConfig(configWith({ 'storage.sftp.privateKey': undefined }))).toThrow(
      /SFTP_PRIVATE_KEY/,
    );
  });

  it('never echoes the private key or password value in the thrown error', () => {
    const key = 'THE-ACTUAL-SECRET-KEY-MATERIAL';
    try {
      validateProductionConfig(configWith({ 'storage.sftp.privateKey': undefined, 'storage.sftp.password': key }));
      fail('expected to throw');
    } catch (err) {
      expect((err as Error).message).not.toContain(key);
    }
  });
});
