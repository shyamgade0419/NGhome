/**
 * The production image has no scripts and no ts-node, so the only way to see
 * whether email works after a Coolify deploy is the container log. These pin
 * that the boot check reports, and that it can never hold up startup.
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

function configWith(mail: Record<string, unknown>) {
  return new ConfigService({ mail });
}

describe('MailService boot check', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('says plainly when email is not configured', () => {
    new MailService(configWith({})).onModuleInit();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOT being sent'));
  });

  it('logs ready when the login succeeds', async () => {
    const svc = new MailService(configWith({ host: 'smtp.example.com', port: 465, user: 'a@b.c', pass: 'x' }));
    jest.spyOn(svc, 'verifyConnection').mockResolvedValue({ ok: true });

    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('SMTP ready'));
  });

  it('logs the reason when the login fails', async () => {
    const svc = new MailService(configWith({ host: 'smtp.example.com', port: 465, user: 'a@b.c', pass: 'x' }));
    jest.spyOn(svc, 'verifyConnection').mockResolvedValue({ ok: false, reason: 'Invalid login: 535' });

    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid login: 535'));
  });

  it('never blocks startup waiting on the mail server', () => {
    const svc = new MailService(configWith({ host: 'smtp.example.com', port: 465, user: 'a@b.c', pass: 'x' }));
    jest.spyOn(svc, 'verifyConnection').mockReturnValue(new Promise(() => undefined)); // never settles

    // Synchronous return: if boot awaited the check, a dead mail server would
    // fail the healthcheck and roll the deploy back.
    expect(svc.onModuleInit()).toBeUndefined();
  });
});

describe('MailService.sendPasswordResetEmail — unconfigured SMTP', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const RESET_URL = 'https://nghome-app.novagade.in/reset-password?token=THE-ACTUAL-SECRET-TOKEN';

  it('logs the live reset link in development — the only way a developer without SMTP set up sees it', async () => {
    const svc = new MailService(new ConfigService({ mail: {}, nodeEnv: 'development' }));
    await svc.sendPasswordResetEmail('resident@example.com', RESET_URL);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(RESET_URL));
  });

  it('never writes the reset link or token to the logs in production, even with SMTP unconfigured', async () => {
    const svc = new MailService(new ConfigService({ mail: {}, nodeEnv: 'production' }));
    await svc.sendPasswordResetEmail('resident@example.com', RESET_URL);

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('resident@example.com'));
    const loggedText = error.mock.calls.map((call) => String(call[0])).join('\n');
    expect(loggedText).not.toContain('THE-ACTUAL-SECRET-TOKEN');
    expect(loggedText).not.toContain(RESET_URL);
  });
});
