import {
  DEFAULT_OFFICIAL_ACCESS, MAX_UPLOAD_BYTES, OFFICIAL_ACCESS_LEVELS, canAddLink, canUploadOfficial, tooLarge, visibilityFor,
} from '@/utils/documents';

describe('who is offered what', () => {
  it.each([
    ['SOCIETY_ADMIN', true, true],
    ['SOCIETY_STAFF', true, true],
    ['COMMITTEE_MEMBER', true, false], // may upload, but the API does not let the committee paste links
    ['RESIDENT', false, false],
    ['SECURITY_GUARD', false, false],
    ['SOCIETY_ACCOUNTANT', false, false],
    [undefined, false, false],
    [null, false, false],
  ])('%s -> upload: %s, link: %s', (role, upload, link) => {
    expect(canUploadOfficial(role)).toBe(upload);
    expect(canAddLink(role)).toBe(link);
  });
});

describe('what an upload sends for visibility', () => {
  it('a resident sends nothing: the server forces their own flat, private', () => {
    expect(visibilityFor({ role: 'RESIDENT', scope: 'flat', flatId: 'f1' })).toEqual({});
    expect(visibilityFor({ role: 'RESIDENT', scope: 'society', accessLevel: 'PUBLIC' })).toEqual({});
  });

  it('an admin on the Society tab sends the chosen level, and no flat', () => {
    expect(visibilityFor({ role: 'SOCIETY_ADMIN', scope: 'society', accessLevel: 'COMMITTEE_ONLY' })).toEqual({ accessLevel: 'COMMITTEE_ONLY' });
  });

  it('defaults to residents-only when nothing was chosen', () => {
    expect(DEFAULT_OFFICIAL_ACCESS).toBe('RESIDENTS_ONLY');
    expect(visibilityFor({ role: 'SOCIETY_STAFF', scope: 'society' })).toEqual({ accessLevel: 'RESIDENTS_ONLY' });
  });

  it('an admin who lives in a flat, on My Flat, names that flat and makes it flat-private (not an official document by accident)', () => {
    expect(visibilityFor({ role: 'SOCIETY_ADMIN', scope: 'flat', flatId: 'f9', accessLevel: 'PUBLIC' })).toEqual({ accessLevel: 'FLAT_PRIVATE', flatId: 'f9' });
  });

  it('never invents a flat: on My Flat without one, nothing is sent', () => {
    expect(visibilityFor({ role: 'SOCIETY_ADMIN', scope: 'flat', flatId: null })).toEqual({});
  });
});

describe('what can be chosen', () => {
  it('offers four official levels and never flat-private (that has its own tab)', () => {
    expect(OFFICIAL_ACCESS_LEVELS.map((a) => a.value)).toEqual(['PUBLIC', 'RESIDENTS_ONLY', 'COMMITTEE_ONLY', 'ADMIN_ONLY']);
    expect(OFFICIAL_ACCESS_LEVELS.every((a) => a.label && a.hint)).toBe(true);
  });

  it('refuses a file over the 10 MB the server accepts, before it is uploaded', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    expect(tooLarge(MAX_UPLOAD_BYTES)).toBe(false);
    expect(tooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(tooLarge(undefined)).toBe(false); // size unknown: let the server decide
    expect(tooLarge(null)).toBe(false);
  });
});
