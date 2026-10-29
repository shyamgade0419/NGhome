/**
 * Which document actions to offer a role, and what an upload should send. The server enforces
 * all of it again (DocumentsController's @Roles and DocumentsService.resolveAccessAndFlat); this
 * only decides what the screen shows, kept pure so it is testable.
 */

import type { DocumentAccessLevel } from '@/api/endpoints/documents.api';

/** Roles the API lets upload an official (society-wide) document: POST /documents/upload. */
export const OFFICIAL_UPLOAD_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_STAFF', 'COMMITTEE_MEMBER'] as const;
/** Roles the API lets paste a link instead: POST /documents (the committee is not among them). */
export const LINK_ROLES = ['SOCIETY_ADMIN', 'SOCIETY_STAFF'] as const;

export const canUploadOfficial = (role?: string | null): boolean => !!role && (OFFICIAL_UPLOAD_ROLES as readonly string[]).includes(role);
export const canAddLink = (role?: string | null): boolean => !!role && (LINK_ROLES as readonly string[]).includes(role);

/** Where an official document may be seen. Flat-private is not offered here: it has its own tab. */
export const OFFICIAL_ACCESS_LEVELS: { value: Exclude<DocumentAccessLevel, 'FLAT_PRIVATE'>; label: string; hint: string }[] = [
  { value: 'PUBLIC', label: 'Everyone', hint: 'Anyone in the society, including staff.' },
  { value: 'RESIDENTS_ONLY', label: 'Residents', hint: 'Residents of the society.' },
  { value: 'COMMITTEE_ONLY', label: 'Committee', hint: 'The committee and admins only.' },
  { value: 'ADMIN_ONLY', label: 'Admins only', hint: 'Only society admins.' },
];

export const DEFAULT_OFFICIAL_ACCESS: DocumentAccessLevel = 'RESIDENTS_ONLY';

/** The largest file the server accepts (10 MB); checked here so a big file fails before it uploads. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const tooLarge = (size?: number | null): boolean => typeof size === 'number' && size > MAX_UPLOAD_BYTES;

/**
 * The visibility fields to send with an upload.
 * - A resident sends none: the server forces their own flat, private.
 * - On "My Flat", anyone else (an admin who also lives in a flat) names that flat and FLAT_PRIVATE,
 *   so it really is private to the flat and not an official document by accident.
 * - On "Society", the chosen level.
 */
export function visibilityFor(args: {
  role?: string | null;
  scope: 'flat' | 'society';
  flatId?: string | null;
  accessLevel?: DocumentAccessLevel;
}): { accessLevel?: DocumentAccessLevel; flatId?: string } {
  if (args.role === 'RESIDENT') return {};
  if (args.scope === 'flat') return args.flatId ? { accessLevel: 'FLAT_PRIVATE', flatId: args.flatId } : {};
  return { accessLevel: args.accessLevel ?? DEFAULT_OFFICIAL_ACCESS };
}
