/**
 * Centralised role utilities — always import from here, never
 * hard-code role strings in page components.
 *
 * Role hierarchy (society-scoped):
 *   SOCIETY_ADMIN      — full control: settings, roles, billing, water, residents
 *   SOCIETY_ACCOUNTANT — billing management + water readings entry
 *   SOCIETY_STAFF      — water readings entry only (e.g. maintenance contractor)
 *   SOCIETY_MEMBER     — resident: view own bills, community
 */

export const ROLE = {
  ADMIN:      'SOCIETY_ADMIN',
  ACCOUNTANT: 'SOCIETY_ACCOUNTANT',
  STAFF:      'SOCIETY_STAFF',
  MEMBER:     'SOCIETY_MEMBER',
  PLATFORM:   'PLATFORM_ADMIN',
} as const;

type Role = (typeof ROLE)[keyof typeof ROLE];

/** Full billing management: create periods, generate, publish, close. */
export const BILLING_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.PLATFORM];

/** Water meter reading entry — extended to staff (they do the physical readings). */
export const WATER_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.STAFF, ROLE.PLATFORM];

/** Society admin–level actions only: settings, role assignment, building config. */
export const ADMIN_ONLY_ROLES: Role[] = [ROLE.ADMIN, ROLE.PLATFORM];

/** All staff roles that see the admin sidebar. */
export const STAFF_ROLES: Role[] = [ROLE.ADMIN, ROLE.ACCOUNTANT, ROLE.STAFF, ROLE.PLATFORM];

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
};
