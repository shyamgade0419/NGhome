import { SystemRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  societyId?: string;
  flatId?: string;
  currentRole?: SystemRole;
  membershipId?: string;
}
