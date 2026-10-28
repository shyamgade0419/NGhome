/**
 * CORS_ORIGINS and APP_URL are pasted by hand into a hosting dashboard, and a
 * trailing slash is an easy slip: a browser's Origin header never has one, so
 * "https://app.example.com/" can never match it, and APP_URL is joined to
 * "/reset-password", which would produce a "//" in emailed links.
 */

import configuration, { addressOf, resolveMailFrom, stripTrailingSlashes } from './configuration';

const KEYS = ['CORS_ORIGINS', 'APP_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => KEYS.forEach((k) => (saved[k] = process.env[k])));
afterEach(() =>
  KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }),
);

describe('stripTrailingSlashes', () => {
  it.each([
    ['https://nghome-app.novagade.in/', 'https://nghome-app.novagade.in'],
    ['https://nghome-app.novagade.in///', 'https://nghome-app.novagade.in'],
    ['  https://nghome-app.novagade.in  ', 'https://nghome-app.novagade.in'],
    ['https://nghome-app.novagade.in', 'https://nghome-app.novagade.in'],
    ['https://example.com/app/', 'https://example.com/app'],
  ])('%s -> %s', (input, expected) => {
    expect(stripTrailingSlashes(input)).toBe(expected);
  });
});

describe('configuration', () => {
  it('normalises every CORS origin and drops empty entries', () => {
    process.env.CORS_ORIGINS = 'https://a.example.com/, https://b.example.com ,,';
    expect(configuration().cors.origins).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('normalises APP_URL so reset links are not built with "//"', () => {
    process.env.APP_URL = 'https://nghome-app.novagade.in/';
    expect(configuration().mail.appUrl).toBe('https://nghome-app.novagade.in');
  });

  it('keeps the local defaults when nothing is set', () => {
    delete process.env.CORS_ORIGINS;
    delete process.env.APP_URL;
    expect(configuration().cors.origins).toEqual(['http://localhost:3000']);
    expect(configuration().mail.appUrl).toBe('http://localhost:3001');
  });
});

describe('resolveMailFrom', () => {
  const PLACEHOLDER = 'NG Home <no-reply@nghome.app>';

  it.each([
    ['unset', undefined, 'noreply@novagade.in', 'NG Home <noreply@novagade.in>'],
    ['empty', '  ', 'noreply@novagade.in', 'NG Home <noreply@novagade.in>'],
    ['the sample placeholder copied into the env', PLACEHOLDER, 'noreply@novagade.in', 'NG Home <noreply@novagade.in>'],
    ['a bare placeholder address', 'no-reply@nghome.app', 'noreply@novagade.in', 'NG Home <noreply@novagade.in>'],
  ])('falls back to the SMTP login when SMTP_FROM is %s', (_why, from, login, expected) => {
    expect(resolveMailFrom(from, login)).toBe(expected);
  });

  it('leaves an address that was set on purpose exactly as written', () => {
    expect(resolveMailFrom('Society Help <help@novagade.in>', 'noreply@novagade.in')).toBe('Society Help <help@novagade.in>');
  });

  it('keeps the placeholder when the login is not an email (an API key, say), so the console still warns', () => {
    expect(resolveMailFrom(undefined, 'apikey')).toBe(PLACEHOLDER);
    expect(resolveMailFrom(PLACEHOLDER, undefined)).toBe(PLACEHOLDER);
  });

  it('is what configuration() hands to the mailer', () => {
    const saved = { f: process.env.SMTP_FROM, u: process.env.SMTP_USER };
    try {
      process.env.SMTP_USER = 'noreply@novagade.in';
      delete process.env.SMTP_FROM;
      expect(configuration().mail.from).toBe('NG Home <noreply@novagade.in>');
    } finally {
      if (saved.f === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = saved.f;
      if (saved.u === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = saved.u;
    }
  });
});

describe('addressOf', () => {
  it.each([
    ['NG Home <a@b.com>', 'a@b.com'],
    ['a@b.com', 'a@b.com'],
    [' a@b.com ', 'a@b.com'],
    ['apikey', null],
    ['', null],
    [undefined, null],
  ])('%j -> %j', (input, out) => expect(addressOf(input as string | undefined)).toBe(out));
});
