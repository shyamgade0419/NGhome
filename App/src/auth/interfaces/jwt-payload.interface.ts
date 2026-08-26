import { SystemRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  isPlatformAdmin: boolean;
  societyId?: string;
  flatId?: string;
  role?: SystemRole;
  membershipId?: string;
  iat?: number;
  exp?: number;
}
