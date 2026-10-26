import { buildPalette, contrastWithWhite, hexToRgb, isHexColor, resolveBranding } from '@/utils/branding';

const DEFAULTS = { color: '#0D2147', tint: '#E9E1D1', onTint: '#0D2147' };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('isHexColor / hexToRgb', () => {
  it.each(['#0D2147', '#1a5fb4', '#FFFFFF'])('accepts %s', (v) => expect(isHexColor(v)).toBe(true));
  it.each(['0D2147', '#12345', '#GGGGGG', 'blue', '', null, undefined, 5])('rejects %j', (v) => expect(isHexColor(v)).toBe(false));
  it('reads channels', () => expect(hexToRgb('#1A5FB4')).toEqual([26, 95, 180]));
});

describe('buildPalette', () => {
  const p = buildPalette('#1A5FB4');

  it('uses the brand colour itself as shade 600', () => {
    expect(p[600]).toBe('#1A5FB4');
  });

  it('runs from light to dark: 300 lighter than 600, 900 darker', () => {
    const lum = (hex: string) => hexToRgb(hex).reduce((a, b) => a + b, 0);
    expect(lum(p[300])).toBeGreaterThan(lum(p[400]));
    expect(lum(p[400])).toBeGreaterThan(lum(p[500]));
    expect(lum(p[500])).toBeGreaterThan(lum(p[600]));
    expect(lum(p[600])).toBeGreaterThan(lum(p[700]));
    expect(lum(p[700])).toBeGreaterThan(lum(p[800]));
    expect(lum(p[800])).toBeGreaterThan(lum(p[900]));
  });

  it('keeps the light shades warm sand with only a trace of the brand, not a pale blue', () => {
    const [r, , b] = hexToRgb(p[50]);
    expect(r).toBeGreaterThan(b); // sand has more red than blue; a blue wash would not
  });

  it('gives only valid #RRGGBB values', () => {
    Object.values(p).forEach((v) => expect(isHexColor(v)).toBe(true));
  });

  it('matches the hand-picked NG Home navy at its anchors', () => {
    const navy = buildPalette('#0D2147');
    expect(navy[600]).toBe('#0D2147');
    // The generated dark shades land within a few points of the originals.
    const near = (a: string, b: string) => hexToRgb(a).every((c, i) => Math.abs(c - hexToRgb(b)[i]) <= 12);
    expect(near(navy[700], '#0A1A38')).toBe(true);
    expect(near(navy[800], '#071428')).toBe(true);
  });
});

describe('contrastWithWhite', () => {
  it('is high for navy and low for pale yellow', () => {
    expect(contrastWithWhite('#0D2147')).toBeGreaterThan(14);
    expect(contrastWithWhite('#FFE066')).toBeLessThan(4.5);
  });
});

describe('resolveBranding', () => {
  it('changes nothing for a society with no branding', () => {
    const r = resolveBranding({ appName: null, primaryColor: null, logoDataUri: null }, DEFAULTS);
    expect(r).toEqual({ appName: null, logoUri: null, ...DEFAULTS, branded: false });
  });

  it('copes with a missing response', () => {
    expect(resolveBranding(undefined, DEFAULTS).branded).toBe(false);
    expect(resolveBranding(null, DEFAULTS).color).toBe('#0D2147');
  });

  it('uses the brand colour, a tint of it, and a dark text shade for the tint', () => {
    const r = resolveBranding({ appName: 'Green Valley', primaryColor: '#1A5FB4', logoDataUri: PNG }, DEFAULTS);
    const p = buildPalette('#1A5FB4');
    expect(r).toEqual({ appName: 'Green Valley', logoUri: PNG, color: '#1A5FB4', tint: p[100], onTint: p[700], branded: true });
  });

  it('trims the name and treats a blank one as none', () => {
    expect(resolveBranding({ appName: '  GV  ' }, DEFAULTS).appName).toBe('GV');
    expect(resolveBranding({ appName: '   ' }, DEFAULTS).appName).toBeNull();
  });

  it('is branded with just a name or just a logo, keeping the default colour', () => {
    expect(resolveBranding({ appName: 'GV' }, DEFAULTS)).toMatchObject({ branded: true, color: '#0D2147' });
    expect(resolveBranding({ logoDataUri: PNG }, DEFAULTS)).toMatchObject({ branded: true, logoUri: PNG });
  });

  it('ignores a colour too pale for white text, rather than making screens unreadable', () => {
    const r = resolveBranding({ appName: 'GV', primaryColor: '#FFE066' }, DEFAULTS);
    expect(r.color).toBe('#0D2147');
    expect(r.appName).toBe('GV');
  });

  it('ignores a malformed colour', () => {
    expect(resolveBranding({ primaryColor: 'red' }, DEFAULTS)).toMatchObject({ color: '#0D2147', branded: false });
  });

  it('ignores a logo that is not an image data URI', () => {
    expect(resolveBranding({ logoDataUri: 'https://evil.example/x.png' }, DEFAULTS).logoUri).toBeNull();
    expect(resolveBranding({ logoDataUri: 'javascript:alert(1)' }, DEFAULTS).logoUri).toBeNull();
  });
});
