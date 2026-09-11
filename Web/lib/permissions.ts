/**
 * Centralised role utilities — always import from here, never
 * hard-code role strings in page components.
 *
 * Role hierarchy (society-scoped) — must match the backend's SystemRole
 * enum (App/prisma/schema.prisma) exactly; the values below are compared
 * directly against activeMembership.role from the API.
 *   SOCIETY_ADMIN      — full control: settings, roles, billing, water, residents
 *   SOCIETY_ACCOUNTANT — billing management + water readings entry
 *   SOCIETY_STAFF      — water readings entry only (e.g. maintenance contractor)
 *   COMMITTEE_MEMBER   — elected committee, above a resident, below staff/admin
 *   RESIDENT           — view own bills, community, upload own flat's documents
 */

import type { Role } from './types';

export const ROLE = {
  ADMIN:      'SOCIETY_ADMIN',
  ACCOUNTANT: 'SOCIETY_ACCOUNTANT',
  STAFF:      'SOCIETY_STAFF',
  COMMITTEE:  'COMMITTEE_MEMBER',
  RESIDENT:   'RESIDENT',
  PLATFORM:   'PLATFORM_ADMIN',
} as const satisfies Record<string, Role>;

/** Full billing management: create periods, generate, publish, close. */
export const BILLING_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.PLATFORM];

/** Water meter reading entry — extended to staff (they do the physical readings). */
export const WATER_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.STAFF, ROLE.PLATFORM];

/** Society admin–level actions only: settings, role assignment, building config. */
export const ADMIN_ONLY_ROLES: Role[] = [ROLE.ADMIN, ROLE.PLATFORM];

/** All staff roles that see the admin sidebar. */
export const STAFF_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.STAFF, ROLE.PLATFORM];

/**
 * Mirrors DocumentsController's @Roles lists exactly (App/src/documents/
 * documents.controller.ts) — kept here, not re-derived, so a backend role
 * change is only ever one file behind on the frontend instead of silently
 * drifting. These gate which actions the UI *offers*; the API is still the
 * one enforcing them, same as everywhere else in this module.
 */
export const DOCUMENT_UPLOAD_ROLES: Role[] = [ROLE.ADMIN, ROLE.STAFF, ROLE.RESIDENT, ROLE.COMMITTEE, ROLE.PLATFORM];
/** The older paste-a-link flow — note COMMITTEE_MEMBER can't use this one. */
export const DOCUMENT_LINK_ROLES: Role[] = [ROLE.ADMIN, ROLE.STAFF, ROLE.RESIDENT, ROLE.PLATFORM];
/** Admin removes any document; a resident only their own (checked server-side too). */
export const DOCUMENT_DELETE_ROLES: Role[] = [ROLE.ADMIN, ROLE.RESIDENT, ROLE.PLATFORM];

// ── Helper functions ──────────────────────────────────────────

function check(allowed: Role[], role?: string | null, isPlatformAdmin?: boolean): boolean {
  if (isPlatformAdmin) return true;
  return allowed.includes((role ?? '') as Role);
}

export const can = {
  manageBilling:     (role?: string | null, isPlatformAdmin?: boolean) => check(BILLING_ROLES, role, isPlatformAdmin),
  enterWaterReadings:(role?: string | null, isPlatformAdmin?: boolean) => check(WATER_ROLES, role, isPlatformAdmin),
  adminOnly:         (role?: string | null, isPlatformAdmin?: boolean) => check(ADMIN_ONLY_ROLES, role, isPlatformAdmin),
  seeAdminNav:       (role?: string | null, isPlatformAdmin?: boolean) => check(STAFF_ROLES, role, isPlatformAdmin),
  uploadDocument:    (role?: string | null, isPlatformAdmin?: boolean) => check(DOCUMENT_UPLOAD_ROLES, role, isPlatformAdmin),
  linkDocument:      (role?: string | null, isPlatformAdmin?: boolean) => check(DOCUMENT_LINK_ROLES, role, isPlatformAdmin),
  deleteDocument:    (role?: string | null, isPlatformAdmin?: boolean) => check(DOCUMENT_DELETE_ROLES, role, isPlatformAdmin),
};

/**
 * Whether this caller picks their own accessLevel/flatId for a document
 * (staff/admin/committee), or always gets FLAT_PRIVATE forced onto their own
 * flat regardless of what the form says (a resident) — mirrors
 * DocumentsService.resolveAccessAndFlat exactly. isPlatformAdmin does NOT
 * override this: a platform admin viewing as a RESIDENT membership still
 * gets the resident treatment, same as the backend (which branches on
 * currentRole === 'RESIDENT', not on isPlatformAdmin).
 */
export function picksOwnDocumentAccess(role?: string | null): boolean {
  return role !== ROLE.RESIDENT;
}
