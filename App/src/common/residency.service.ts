import { Injectable } from '@nestjs/common';
import { ResidencyType, SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Who counts as a tenant when they look at the society's money.
 *
 * A tenant sees what they pay for — regular maintenance, expenses, their own bills — but not the corpus
 * fund or the bank balances: those belong to the owners. This is decided here, on the server, from the
 * caller's own membership; the apps only hide what the API no longer sends.
 *
 * Only a resident membership marked TENANT is held back. The admin, accountant and committee, and a
 * platform admin, are never treated as tenants — what they see is governed by their role as before.
 */
@Injectable()
export class ResidencyService {
  constructor(private readonly prisma: PrismaService) {}

  async isTenantViewer(user: { membershipId?: string; currentRole?: SystemRole | string; isPlatformAdmin?: boolean }): Promise<boolean> {
    if (user.isPlatformAdmin || user.currentRole !== SystemRole.RESIDENT || !user.membershipId) return false;
    const membership = await this.prisma.societyMembership.findUnique({
      where: { id: user.membershipId },
      select: { residencyType: true },
    });
    return membership?.residencyType === ResidencyType.TENANT;
  }
}
