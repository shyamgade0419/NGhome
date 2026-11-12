/**
 * Who a notification goes to, beyond "everyone": a building, specific flats, the committee or the staff. The choice is an
 * audience (an AnnouncementAudience) plus, for a building or flats, which ones (the audience config).
 */
import { AnnouncementAudience } from '@prisma/client';

export interface AudienceConfig {
  buildingIds?: string[];
  flatIds?: string[];
}

/** Far more than any society has, so a runaway list is refused rather than turned into a huge query. */
export const MAX_AUDIENCE_IDS = 500;

const cleanIds = (raw: unknown): string[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()))];
  return ids.slice(0, MAX_AUDIENCE_IDS);
};

/** What is stored: only the two known lists, each a list of non-empty text ids with repeats removed. Anything else is dropped. */
export function cleanAudienceConfig(raw: unknown): AudienceConfig {
  const source = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const buildingIds = cleanIds(source.buildingIds);
  const flatIds = cleanIds(source.flatIds);
  return { ...(buildingIds ? { buildingIds } : {}), ...(flatIds ? { flatIds } : {}) };
}

/** Whether this audience is chosen by building or by flat, i.e. needs a list. */
export const needsBuildings = (audience: AnnouncementAudience): boolean => audience === 'BUILDING' || audience === 'BLOCK';
export const needsFlats = (audience: AnnouncementAudience): boolean => audience === 'SPECIFIC_FLATS';

/**
 * Why an audience and its config cannot be used, in words for the admin, or null when they are fine. A building or flats
 * audience with nothing chosen is refused: it would reach nobody, and "sent" would be a lie.
 */
export function audienceProblem(audience: AnnouncementAudience, config: AudienceConfig): string | null {
  if (needsBuildings(audience) && !(config.buildingIds?.length)) return 'Choose at least one building to send to.';
  if (needsFlats(audience) && !(config.flatIds?.length)) return 'Choose at least one flat to send to.';
  const tooMany = (config.buildingIds?.length ?? 0) > MAX_AUDIENCE_IDS || (config.flatIds?.length ?? 0) > MAX_AUDIENCE_IDS;
  return tooMany ? `Choose at most ${MAX_AUDIENCE_IDS} at a time.` : null;
}

/** A short description of who got it, for the admin's confirmation: 'everyone', 'the committee', '2 buildings'. */
export function audienceLabel(audience: AnnouncementAudience, config: AudienceConfig): string {
  const n = (count: number | undefined, one: string, many: string) => `${count ?? 0} ${count === 1 ? one : many}`;
  switch (audience) {
    case 'COMMITTEE': return 'the committee';
    case 'STAFF': return 'the staff';
    case 'BUILDING':
    case 'BLOCK': return n(config.buildingIds?.length, 'building', 'buildings');
    case 'SPECIFIC_FLATS': return n(config.flatIds?.length, 'flat', 'flats');
    default: return 'everyone';
  }
}
