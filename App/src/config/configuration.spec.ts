/**
 * CORS_ORIGINS and APP_URL are pasted by hand into a hosting dashboard, and a
 * trailing slash is an easy slip: a browser's Origin header never has one, so
 * "https://app.example.com/" can never match it, and APP_URL is joined to
 * "/reset-password", which would produce a "//" in emailed links.
 */

import configuration, { stripTrailingSlashes } from './configuration';

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
