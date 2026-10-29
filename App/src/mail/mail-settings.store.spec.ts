import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { MailSettingsStore } from './mail-settings.store';
import { decryptSecret, encryptSecret } from './secret-box';

describe('secret-box', () => {
  it('round-trips, and a stored value does not contain the secret', () => {
    const stored = encryptSecret('Sup3r-Secret!', 'key-1');
    expect(stored).not.toContain('Sup3r-Secret!');
    expect(decryptSecret(stored, 'key-1')).toBe('Sup3r-Secret!');
  });

  it('locks the same text differently each time', () => {
    expect(encryptSecret('x', 'k')).not.toBe(encryptSecret('x', 'k'));
  });

  it('cannot be read with a different key, and says so instead of throwing', () => {
    expect(decryptSecret(encryptSecret('x', 'key-1'), 'key-2')).toBeNull();
  });

  it('rejects tampered and malformed values', () => {
    const stored = encryptSecret('hello', 'k');
    const [v, iv, tag, ct] = stored.split('.');
    expect(decryptSecret([v, iv, tag, ct.slice(0, -2) + 'AA'].join('.'), 'k')).toBeNull();
    expect(decryptSecret('not-encrypted', 'k')).toBeNull();
    expect(decryptSecret('', 'k')).toBeNull();
  });
});

type Row = {
  id: string; host: string; port: number; username: string | null; passwordEnc: string | null;
  fromAddress: string | null; fromName: string | null; updatedById: string | null; updatedAt: Date;
};

function fakePrisma() {
  let row: Row | null = null;
  const audit: any[] = [];
  const prisma = {
    platformMailSettings: {
      findUnique: jest.fn(async () => row),
      upsert: jest.fn(async ({ create, update }: any) => {
        row = { ...(row ?? create), ...(row ? update : {}), id: 'singleton', updatedAt: new Date() } as Row;
        return row;
      }),
      delete: jest.fn(async () => { row = null; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); }) },
  } as unknown as PrismaService;
  return { prisma, audit, rowRef: () => row };
}

const config = (over: Record<string, unknown> = {}) =>
  new ConfigService({ jwt: { accessSecret: 'jwt-secret' }, nodeEnv: 'production', mail: { appUrl: 'https://x.test', ...over } });

describe('MailSettingsStore', () => {
  const ACTOR = 'admin-1';

  it('stores the password encrypted and never returns it', async () => {
    const { prisma, rowRef } = fakePrisma();
    const store = new MailSettingsStore(prisma, config());
    const view = await store.save({ host: 'smtp.novagade.com', port: 465, username: 'billing@novagade.com', password: 'PW-123' }, ACTOR);

    expect(rowRef()!.passwordEnc).toBeTruthy();
    expect(rowRef()!.passwordEnc).not.toContain('PW-123');
    expect(JSON.stringify(view)).not.toContain('PW-123');
    expect(view).toMatchObject({ source: 'console', host: 'smtp.novagade.com', port: 465, hasPassword: true, passwordUnreadable: false });
    expect((await store.load())!.password).toBe('PW-123');
  });

  it('keeps the saved password when it is left blank on a later save', async () => {
    const { prisma } = fakePrisma();
    const store = new MailSettingsStore(prisma, config());
    await store.save({ host: 'smtp.a.com', port: 465, username: 'u@a.com', password: 'first' }, ACTOR);
    await store.save({ host: 'smtp.b.com', port: 587, username: 'u@b.com', password: '' }, ACTOR);
    expect(await store.load()).toMatchObject({ host: 'smtp.b.com', port: 587, password: 'first' });
  });

  it('needs a password the first time a login is saved', async () => {
    const { prisma } = fakePrisma();
    await expect(new MailSettingsStore(prisma, config()).save({ host: 'smtp.a.com', port: 465, username: 'u@a.com' }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
  });

  it.each(['https://smtp.a.com', 'smtp.a.com/mail', 'smtp a.com', '   '])('refuses the server name %j', async (host) => {
    const { prisma } = fakePrisma();
    await expect(new MailSettingsStore(prisma, config()).save({ host, port: 465, username: 'u@a.com', password: 'x' }, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a From address that is not an email address', async () => {
    const { prisma } = fakePrisma();
    await expect(
      new MailSettingsStore(prisma, config()).save({ host: 'smtp.a.com', port: 465, username: 'u@a.com', password: 'x', fromAddress: 'nope' }, ACTOR),
    ).rejects.toThrow(/From address/);
  });

  it('records who changed what in the audit log, without the password', async () => {
    const { prisma, audit } = fakePrisma();
    const store = new MailSettingsStore(prisma, config());
    await store.save({ host: 'smtp.a.com', port: 465, username: 'u@a.com', password: 'TOP-SECRET' }, ACTOR);
    await store.clear(ACTOR);

    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorId: ACTOR, entityType: 'PlatformMailSettings', newValues: { host: 'smtp.a.com', passwordChanged: true } });
    expect(audit[1].newValues).toEqual({ removed: true });
    expect(JSON.stringify(audit)).not.toContain('TOP-SECRET');
  });

  it('reports the environment as the source until something is saved, and after it is cleared', async () => {
    const { prisma } = fakePrisma();
    const store = new MailSettingsStore(prisma, config({ host: 'env.smtp.com', port: 587, user: 'env@x.com' }));
    expect(await store.view()).toMatchObject({ source: 'environment', host: null, environment: { host: 'env.smtp.com', port: 587, user: 'env@x.com' } });
    await store.save({ host: 'smtp.a.com', port: 465, username: 'u@a.com', password: 'x' }, ACTOR);
    expect((await store.view()).source).toBe('console');
    expect((await store.clear(ACTOR)).source).toBe('environment');
  });

  it('says the password is unreadable when the key has changed, instead of failing', async () => {
    const { prisma } = fakePrisma();
    await new MailSettingsStore(prisma, config()).save({ host: 'smtp.a.com', port: 465, username: 'u@a.com', password: 'x' }, ACTOR);
    const rotated = new MailSettingsStore(prisma, new ConfigService({ jwt: { accessSecret: 'a-different-secret' }, mail: {} }));
    expect(await rotated.view()).toMatchObject({ hasPassword: true, passwordUnreadable: true });
    expect((await rotated.load())!.password).toBeNull();
  });
});

describe('MailService — which login is used', () => {
  const stored = (over = {}) => ({
    host: 'smtp.novagade.com', port: 465, username: 'billing@novagade.com', password: 'pw',
    passwordUnreadable: false, fromAddress: null, fromName: null, ...over,
  });
  const storeReturning = (v: unknown) => ({ load: jest.fn().mockResolvedValue(v) }) as unknown as MailSettingsStore;
  const env = new ConfigService({ nodeEnv: 'production', mail: { host: 'env.smtp.com', port: 587, user: 'env@env.com', pass: 'envpw', from: 'NG Home <env@env.com>', appUrl: 'https://x.test' } });

  it('uses the console settings over the environment', async () => {
    const setup = await new MailService(env, storeReturning(stored())).describe();
    expect(setup).toMatchObject({ source: 'console', host: 'smtp.novagade.com', port: 465, from: '"NG Home" <billing@novagade.com>' });
  });

  it('uses the From address and name when they are set', async () => {
    const setup = await new MailService(env, storeReturning(stored({ fromAddress: 'support@novagade.com', fromName: 'NovaGade "Support"' }))).describe();
    expect(setup.from).toBe('"NovaGade Support" <support@novagade.com>');
  });

  it('falls back to the environment when nothing is saved', async () => {
    const setup = await new MailService(env, storeReturning(null)).describe();
    expect(setup).toMatchObject({ source: 'environment', host: 'env.smtp.com', port: 587 });
  });

  it('falls back to the environment, instead of failing, when the saved settings cannot be read', async () => {
    const broken = { load: jest.fn().mockRejectedValue(new Error('relation "platform_mail_settings" does not exist')) } as unknown as MailSettingsStore;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const setup = await new MailService(env, broken).describe();
    expect(setup.source).toBe('environment');
  });

  it('warns when the saved password can no longer be read', async () => {
    const setup = await new MailService(env, storeReturning(stored({ password: null, passwordUnreadable: true }))).describe();
    expect(setup.warnings.join(' ')).toMatch(/password can no longer be read/);
  });

  it('never includes the password in what it reports', async () => {
    expect(JSON.stringify(await new MailService(env, storeReturning(stored({ password: 'HUSH-HUSH' }))).describe())).not.toContain('HUSH-HUSH');
  });
});
