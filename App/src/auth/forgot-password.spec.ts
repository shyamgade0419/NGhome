/**
 * forgotPassword promises, at its top, never to reveal whether an email is
 * registered. It used to await the email send with nothing catching it, so
 * when SMTP failed a registered address got a 500 while an unregistered one
 * got success — a failed request confirmed the account existed. It also made
 * every reset wait on the mail server, a timing signal for the same thing.
 */

import { Logger } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const USER = { id: 'user-1', email: 'resident@example.com', isActive: true };

function makeService(opts: { user?: unknown; send?: jest.Mock } = {}) {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue('user' in opts ? opts.user : USER) },
    passwordResetToken: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const send = opts.send ?? jest.fn().mockResolvedValue(undefined);
  const mail = { sendPasswordResetEmail: send } as unknown as MailService;
  const config = { get: jest.fn().mockReturnValue('https://nghome-app.novagade.in') } as any;
  return { service: new AuthService(prisma, {} as any, config, mail), prisma, send };
}

describe('AuthService.forgotPassword', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('reports success for a registered email even when the mail server is down', async () => {
    const { service } = makeService({
      send: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT 169.58.109.238:465')),
    });
    // Must resolve exactly as it does for an unknown email — not throw.
    await expect(service.forgotPassword({ email: USER.email })).resolves.toBeUndefined();
  });

  it('logs the failure, since the user is never told', async () => {
    const { service } = makeService({
      send: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT 169.58.109.238:465')),
    });
    await service.forgotPassword({ email: USER.email });
    await new Promise((r) => setImmediate(r)); // let the unawaited send settle

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ETIMEDOUT'));
    // The user id is enough to trace it; the address itself stays out of logs.
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining(USER.email));
  });

  it('does not wait on the mail server before responding', async () => {
    let resolveSend: () => void = () => undefined;
    const send = jest.fn(() => new Promise<void>((r) => { resolveSend = r; }));
    const { service } = makeService({ send });

    // If the send were awaited this would never settle, because the send never does.
    await expect(service.forgotPassword({ email: USER.email })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalled();
    resolveSend();
  });

  it('sends a link to the reset page carrying the token', async () => {
    const { service, send } = makeService();
    await service.forgotPassword({ email: USER.email });

    const [to, url] = send.mock.calls[0];
    expect(to).toBe(USER.email);
    expect(url).toMatch(/^https:\/\/nghome-app\.novagade\.in\/reset-password\?token=[0-9a-f]{64}$/);
  });

  it('sends nothing for an unknown email, and still reports success', async () => {
    const { service, send, prisma } = makeService({ user: null });
    await expect(service.forgotPassword({ email: 'nobody@example.com' })).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
  });

  it('stores only a hash of the token, never the token itself', async () => {
    const { service, send, prisma } = makeService();
    await service.forgotPassword({ email: USER.email });

    const [, url] = send.mock.calls[0];
    const rawToken = new URL(url).searchParams.get('token');
    const [createArg] = (prisma.passwordResetToken.create as jest.Mock).mock.calls[0];
    expect(createArg.data.tokenHash).not.toBe(rawToken);
    expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthService.issuePasswordResetLinkReporting', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errorSpy.mockRestore());

  it('reports success only once the mail server has accepted the message', async () => {
    const { service, send } = makeService({ send: jest.fn().mockResolvedValue(true) });
    await expect(service.issuePasswordResetLinkReporting('user-1', 'a@b.com')).resolves.toEqual({ emailSent: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says so when SMTP is not configured, instead of claiming it sent', async () => {
    const { service } = makeService({ send: jest.fn().mockResolvedValue(false) });
    const out = await service.issuePasswordResetLinkReporting('user-1', 'a@b.com');
    expect(out.emailSent).toBe(false);
    expect(out.emailError).toMatch(/SMTP/);
  });

  it("returns the mail server's own reason when it refuses, rather than throwing", async () => {
    const { service } = makeService({
      send: jest.fn().mockRejectedValue(new Error('Invalid login: 535-5.7.8 Username and Password not accepted')),
    });
    const out = await service.issuePasswordResetLinkReporting('user-1', 'a@b.com');
    expect(out).toEqual({ emailSent: false, emailError: expect.stringContaining('Username and Password not accepted') });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('still issues the reset token when the email fails, so a resend can follow', async () => {
    const { service, prisma } = makeService({ send: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) });
    await service.issuePasswordResetLinkReporting('user-1', 'a@b.com');
    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the long error short enough for a toast', async () => {
    const { service } = makeService({ send: jest.fn().mockRejectedValue(new Error('x'.repeat(2000))) });
    const out = await service.issuePasswordResetLinkReporting('user-1', 'a@b.com');
    expect(out.emailError!.length).toBeLessThanOrEqual(300);
  });
});
