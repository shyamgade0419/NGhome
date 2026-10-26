import { BadRequestException, NotFoundException, ValidationPipe } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { SocietyBrandingService } from './society-branding.service';
import { MAX_LOGO_BYTES, checkLogo, contrastWithWhite, readBranding, scrubLogo } from './branding';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = (extra = 32) => Buffer.from([...PNG_MAGIC, ...new Array(extra).fill(7)]);
const jpegBytes = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const webpBytes = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([20, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 ')]);
const uri = (mime: string, bytes: Buffer) => `data:image/${mime};base64,${bytes.toString('base64')}`;

describe('contrastWithWhite', () => {
  it('is 21 for black and 1 for white', () => {
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(contrastWithWhite('#FFFFFF')).toBeCloseTo(1, 1);
  });
  it('passes the existing NG Home navy comfortably', () => {
    expect(contrastWithWhite('#0D2147')).toBeGreaterThan(14);
  });
  it('fails a pale yellow that would make white text unreadable', () => {
    expect(contrastWithWhite('#FFE066')).toBeLessThan(4.5);
  });
});

describe('checkLogo', () => {
  it.each([
    ['png', pngBytes()],
    ['jpeg', jpegBytes()],
    ['webp', webpBytes()],
  ])('accepts a real %s', (mime, bytes) => {
    expect(checkLogo(uri(mime, bytes as Buffer))).toEqual({ ok: true });
  });

  it('refuses SVG, which can carry script', () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
    expect(checkLogo(svg).ok).toBe(false);
  });

  it('refuses a file that claims to be a PNG but is something else', () => {
    const r = checkLogo(uri('png', Buffer.from('<html><script>alert(1)</script></html>')));
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('not really') });
  });

  it('refuses a JPEG sent with a PNG label', () => {
    expect(checkLogo(uri('png', jpegBytes())).ok).toBe(false);
  });

  it('refuses a logo over the size limit, saying how big it is', () => {
    const big = Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(MAX_LOGO_BYTES + 10)]);
    const r = checkLogo(uri('png', big));
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/KB/);
  });

  it.each(['', 'not a data uri', 'https://example.com/logo.png', 'data:text/html;base64,PGI+', 'data:image/png;base64,'])(
    'refuses %j',
    (value) => {
      expect(checkLogo(value).ok).toBe(false);
    },
  );
});

describe('readBranding', () => {
  it('returns nothing set for a society that never had branding', () => {
    expect(readBranding(undefined)).toEqual({ appName: null, primaryColor: null, logoDataUri: null });
    expect(readBranding({})).toEqual({ appName: null, primaryColor: null, logoDataUri: null });
    expect(readBranding({ upiId: 'x@bank' })).toEqual({ appName: null, primaryColor: null, logoDataUri: null });
  });

  it('survives a malformed stored value instead of crashing every screen', () => {
    expect(readBranding({ branding: 'oops' })).toEqual({ appName: null, primaryColor: null, logoDataUri: null });
    expect(readBranding({ branding: { primaryColor: 'red', appName: 5 } })).toEqual({ appName: null, primaryColor: null, logoDataUri: null });
  });
});

describe('scrubLogo', () => {
  it('removes the logo but says there is one', () => {
    const out: any = scrubLogo({ additionalConfig: { upiId: 'a@b', branding: { appName: 'GV', logoDataUri: 'data:...' } } });
    expect(out.additionalConfig.upiId).toBe('a@b');
    expect(out.additionalConfig.branding).toEqual({ appName: 'GV', hasLogo: true });
    expect(JSON.stringify(out)).not.toContain('data:...');
  });

  it('leaves a config with no logo alone', () => {
    const cfg = { additionalConfig: { upiId: 'a@b' } };
    expect(scrubLogo(cfg)).toBe(cfg);
    expect(scrubLogo(null)).toBeNull();
  });
});

describe('UpdateBrandingDto validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown) => pipe.transform(value, { type: 'body', metatype: UpdateBrandingDto });

  it('accepts a full payload and trims the name', async () => {
    const out: any = await run({ appName: '  Green Valley ', primaryColor: '#1A5FB4', logoDataUri: uri('png', pngBytes()) });
    expect(out.appName).toBe('Green Valley');
  });

  it('accepts null to clear each field', async () => {
    await expect(run({ appName: null, primaryColor: null, logoDataUri: null })).resolves.toMatchObject({ appName: null });
  });

  it.each(['blue', '#12345', '#GGGGGG', '1A5FB4', 'rgb(1,2,3)'])('rejects the colour %j', async (primaryColor) => {
    await expect(run({ primaryColor })).rejects.toThrow(BadRequestException);
  });

  it('rejects a name over 40 characters', async () => {
    await expect(run({ appName: 'x'.repeat(41) })).rejects.toThrow(BadRequestException);
  });

  it.each(['societyId', 'isActive', 'joinCode', 'name'])('refuses an unrelated field: %s', async (field) => {
    await expect(run({ appName: 'X', [field]: 'y' })).rejects.toThrow(BadRequestException);
  });
});

describe('SocietyBrandingService', () => {
  const SOCIETY = 'soc-1';
  const ACTOR = 'platform-admin-1';

  function build(opts: { society?: unknown; additionalConfig?: unknown } = {}) {
    const upsert = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      society: { findFirst: jest.fn().mockResolvedValue('society' in opts ? opts.society : { id: SOCIETY }) },
      societyConfiguration: {
        findUnique: jest.fn().mockResolvedValue({ additionalConfig: opts.additionalConfig ?? {} }),
        upsert,
      },
      auditLog: { create: auditCreate },
    } as unknown as PrismaService;
    return { service: new SocietyBrandingService(prisma), prisma, upsert, auditCreate };
  }
  const saved = (upsert: jest.Mock) => upsert.mock.calls[0][0].update.additionalConfig;

  it('saves name, colour (upper-cased) and logo', async () => {
    const { service, upsert } = build();
    const out = await service.update(SOCIETY, { appName: 'Green Valley', primaryColor: '#1a5fb4', logoDataUri: uri('png', pngBytes()) }, ACTOR);
    expect(out).toMatchObject({ appName: 'Green Valley', primaryColor: '#1A5FB4' });
    expect(saved(upsert).branding.appName).toBe('Green Valley');
  });

  it('keeps the rest of additionalConfig exactly as it was', async () => {
    const { service, upsert } = build({ additionalConfig: { upiId: 'gv@bank', waterBillingEnabled: false } });
    await service.update(SOCIETY, { appName: 'GV' }, ACTOR);
    expect(saved(upsert)).toMatchObject({ upiId: 'gv@bank', waterBillingEnabled: false, branding: { appName: 'GV' } });
  });

  it('leaves a field alone when it is left out, and clears it when null', async () => {
    const existing = { branding: { appName: 'Old', primaryColor: '#0D2147', logoDataUri: uri('png', pngBytes()) } };
    const a = build({ additionalConfig: existing });
    await a.service.update(SOCIETY, { appName: 'New' }, ACTOR);
    expect(saved(a.upsert).branding).toMatchObject({ appName: 'New', primaryColor: '#0D2147' });
    expect(saved(a.upsert).branding.logoDataUri).toBeTruthy();

    const b = build({ additionalConfig: existing });
    await b.service.update(SOCIETY, { logoDataUri: null, appName: '' }, ACTOR);
    expect(saved(b.upsert).branding).toMatchObject({ appName: null, logoDataUri: null, primaryColor: '#0D2147' });
  });

  it('refuses a colour too pale for white text, with the contrast in the message', async () => {
    const { service, upsert } = build();
    const err: any = await service.update(SOCIETY, { primaryColor: '#FFE066' }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/too light/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a logo that is not a real image', async () => {
    const { service, upsert } = build();
    await expect(service.update(SOCIETY, { logoDataUri: uri('png', Buffer.from('<script>')) }, ACTOR)).rejects.toThrow(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not find a society that does not exist or was deleted', async () => {
    const { service, prisma } = build({ society: null });
    await expect(service.update('nope', { appName: 'X' }, ACTOR)).rejects.toThrow(NotFoundException);
    expect(prisma.society.findFirst).toHaveBeenCalledWith({ where: { id: 'nope', deletedAt: null }, select: { id: true } });
  });

  it('works for a society with no configuration row yet', async () => {
    const { service, upsert } = build();
    await service.update(SOCIETY, { appName: 'GV' }, ACTOR);
    expect(upsert.mock.calls[0][0].create).toMatchObject({ societyId: SOCIETY });
  });

  it('records who changed it, without writing the logo into the audit trail', async () => {
    const { service, auditCreate } = build();
    await service.update(SOCIETY, { appName: 'GV', logoDataUri: uri('png', pngBytes()) }, ACTOR);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ societyId: SOCIETY, actorId: ACTOR, entityType: 'SocietyConfiguration' });
    expect(data.newValues).toMatchObject({ action: 'BRANDING_UPDATED', appName: 'GV', hasLogo: true });
    expect(JSON.stringify(data)).not.toContain('base64');
  });

  it('reads back what is stored, and nulls for a society with none', async () => {
    const withBranding = build({ additionalConfig: { branding: { appName: 'GV', primaryColor: '#0D2147', logoDataUri: null } } });
    await expect(withBranding.service.get(SOCIETY)).resolves.toEqual({ appName: 'GV', primaryColor: '#0D2147', logoDataUri: null });
    await expect(build().service.get(SOCIETY)).resolves.toEqual({ appName: null, primaryColor: null, logoDataUri: null });
  });
});
