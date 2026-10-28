import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService, maskEmail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformMailService } from './platform-mail.service';

const mailConfig = (over: Record<string, unknown> = {}, nodeEnv = 'production') =>
  new ConfigService({
    nodeEnv,
    mail: {
      host: 'smtp.example.com',
      port: 587,
      user: 'noreply@novagade.in',
      pass: 'SUPER-SECRET-PASSWORD',
      from: 'NG Home <no-reply@novagade.in>',
      appUrl: 'https://nghome-app.novagade.in',
      ...over,
    },
  });

describe('maskEmail', () => {
  it.each([
    ['noreply@novagade.in', 'no***@novagade.in'],
    ['a@b.com', 'a***@b.com'],
    [null, null],
    ['', null],
  ])('%j -> %j', (input, out) => expect(maskEmail(input as string | null)).toBe(out));
});

describe('MailService.describe', () => {
  it('reports the setup without ever including the password', () => {
    const setup = new MailService(mailConfig()).describe();
    expect(setup).toMatchObject({ configured: true, host: 'smtp.example.com', port: 587, user: 'no***@novagade.in' });
    expect(JSON.stringify(setup)).not.toContain('SUPER-SECRET-PASSWORD');
    expect(setup.warnings).toEqual([]);
  });

  it('says so when no SMTP host is set at all', () => {
    const setup = new MailService(mailConfig({ host: undefined })).describe();
    expect(setup.configured).toBe(false);
    expect(setup.warnings.join(' ')).toMatch(/SMTP_HOST is not set/);
  });

  it('warns about the placeholder sender domain that many providers reject', () => {
    const setup = new MailService(mailConfig({ from: 'NG Home <no-reply@nghome.app>' })).describe();
    expect(setup.warnings.join(' ')).toMatch(/SMTP_FROM/);
  });

  it('warns when production links would point at localhost', () => {
    const setup = new MailService(mailConfig({ appUrl: 'http://localhost:3001' })).describe();
    expect(setup.warnings.join(' ')).toMatch(/APP_URL/);
  });

  it('does not nag about localhost in development', () => {
    const setup = new MailService(mailConfig({ appUrl: 'http://localhost:3001' }, 'development')).describe();
    expect(setup.warnings.join(' ')).not.toMatch(/APP_URL/);
  });

  it('warns when there is a host but no login', () => {
    const setup = new MailService(mailConfig({ user: undefined })).describe();
    expect(setup.warnings.join(' ')).toMatch(/SMTP_USER/);
  });
});

describe('MailService.sendTest', () => {
  it('reports that nothing was sent when SMTP is not configured', async () => {
    const svc = new MailService(mailConfig({ host: undefined }));
    await expect(svc.sendTest('a@b.com')).resolves.toEqual({ ok: false, reason: 'SMTP_HOST is not set' });
  });
});

describe('PlatformMailService.check', () => {
  const ACTOR = 'admin-1';
  const prismaWith = (user: unknown) => ({ user: { findUnique: jest.fn().mockResolvedValue(user) } }) as unknown as PrismaService;
  const mailWith = (opts: { verify: unknown; send?: unknown }) =>
    ({
      describe: jest.fn().mockReturnValue({ configured: true, warnings: [] }),
      verifyConnection: jest.fn().mockResolvedValue(opts.verify),
      sendTest: jest.fn().mockResolvedValue(opts.send ?? { ok: true }),
    }) as unknown as MailService;

  it('logs in, then sends a real test to the admin who asked', async () => {
    const mail = mailWith({ verify: { ok: true } });
    const out = await new PlatformMailService(prismaWith({ email: 'me@novagade.in' }), mail).check(ACTOR);
    expect(mail.sendTest).toHaveBeenCalledWith('me@novagade.in');
    expect(out.connection).toEqual({ ok: true });
    expect(out.test).toEqual({ to: 'me@novagade.in', ok: true });
  });

  it('stops at a failed login and does not try to send', async () => {
    const mail = mailWith({ verify: { ok: false, reason: 'Invalid login: 535 Username and Password not accepted' } });
    const out = await new PlatformMailService(prismaWith({ email: 'me@novagade.in' }), mail).check(ACTOR);
    expect(out.connection).toEqual({ ok: false, reason: expect.stringContaining('535') });
    expect(out.test).toBeNull();
    expect(mail.sendTest).not.toHaveBeenCalled();
  });

  it('reports a send that the mail server refused, with the reason', async () => {
    const mail = mailWith({ verify: { ok: true }, send: { ok: false, reason: '553 Sender address rejected' } });
    const out = await new PlatformMailService(prismaWith({ email: 'me@novagade.in' }), mail).check(ACTOR);
    expect(out.test).toEqual({ to: 'me@novagade.in', ok: false, reason: expect.stringContaining('553') });
  });

  it('only ever sends to the admin asking, never to an address supplied by the caller', async () => {
    const mail = mailWith({ verify: { ok: true } });
    await new PlatformMailService(prismaWith({ email: 'me@novagade.in' }), mail).check(ACTOR);
    expect((mail.sendTest as jest.Mock).mock.calls).toEqual([['me@novagade.in']]);
  });

  it('is not found for an unknown admin', async () => {
    await expect(new PlatformMailService(prismaWith(null), mailWith({ verify: { ok: true } })).check('nope')).rejects.toThrow(NotFoundException);
  });
});
