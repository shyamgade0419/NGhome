/**
 * The look of the app: read once when the app starts, defaulting to glass; a saved choice is kept for next time; the glass palette
 * has every name the classic one has, so no screen can be left without a colour.
 */

const mockGetItem = jest.fn();
const mockSetItemAsync = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  setItemAsync: (...a: unknown[]) => mockSetItemAsync(...a),
}));

function load(stored: unknown) {
  mockGetItem.mockReset().mockReturnValue(stored);
  let mod!: typeof import('@/theme/look');
  let theme!: typeof import('@/theme/colors');
  jest.isolateModules(() => {
    mod = require('@/theme/look');
    theme = require('@/theme/colors');
  });
  return { mod, theme };
}

beforeEach(() => {
  mockSetItemAsync.mockReset().mockResolvedValue(undefined);
});

describe('which look the app opens in', () => {
  it('is glass when nothing has been chosen', () => {
    const { mod, theme } = load(null);
    expect(mod.appliedLook).toBe('glass');
    expect(mod.isGlass).toBe(true);
    expect(theme.colors).toBe(theme.glassColors);
  });

  it('is classic when that is what was chosen, with the classic palette', () => {
    const { mod, theme } = load('classic');
    expect(mod.appliedLook).toBe('classic');
    expect(mod.isGlass).toBe(false);
    expect(theme.colors).toBe(theme.classicColors);
    expect(theme.colors.background).toBe('#F4EEE2');
  });

  it('falls back to glass for a value it does not know, and when storage cannot be read', () => {
    expect(load('purple').mod.appliedLook).toBe('glass');
    mockGetItem.mockReset().mockImplementation(() => { throw new Error('keystore unavailable'); });
    let mod!: typeof import('@/theme/look');
    jest.isolateModules(() => { mod = require('@/theme/look'); });
    expect(mod.appliedLook).toBe('glass');
  });

  it('keeps showing the look it opened in after a new choice, which is only for the next open', async () => {
    const { mod } = load('glass');
    await mod.saveLook('classic');
    expect(mockSetItemAsync).toHaveBeenCalledWith('nghome_look', 'classic');
    expect(mod.appliedLook).toBe('glass');
    mockGetItem.mockReturnValue('classic');
    expect(mod.chosenLook()).toBe('classic');
  });

  it('does not fail when a choice cannot be kept', async () => {
    const { mod } = load(null);
    mockSetItemAsync.mockRejectedValue(new Error('disk full'));
    await expect(mod.saveLook('classic')).resolves.toBeUndefined();
  });
});

describe('the glass palette', () => {
  const { theme } = load(null);

  it('has every colour name the classic palette has, as a string', () => {
    expect(Object.keys(theme.glassColors).sort()).toEqual(Object.keys(theme.classicColors).sort());
    for (const v of Object.values(theme.glassColors)) expect(typeof v).toBe('string');
  });

  it('lets the aurora through the screen background, and frosts the surfaces', () => {
    expect(theme.glassColors.background).toBe('transparent');
    expect(theme.glassColors.surface).toMatch(/^rgba\(255,255,255,0\.\d+\)$/);
  });

  it('keeps the brand colours as plain hex, since two screens add an alpha suffix to them', () => {
    expect(theme.glassColors.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(theme.glassColors.primaryLight).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
