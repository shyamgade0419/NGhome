import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBrandingDto } from './dto/update-branding.dto';
import { Branding, MIN_CONTRAST_WITH_WHITE, checkLogo, contrastWithWhite, readBranding } from './branding';

@Injectable()
export class SocietyBrandingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The society's branding, with nulls for anything not set. Read by any member, so no write path lives here. */
  async get(societyId: string): Promise<Branding> {
    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
      select: { additionalConfig: true },
    });
    return readBranding(config?.additionalConfig);
  }

  /**
   * Platform-admin only (enforced at the route). A field left out keeps its
   * value; null — or an empty name — clears it. Everything else in
   * additionalConfig (UPI id, water switch, …) is carried over untouched.
   */
  async update(societyId: string, dto: UpdateBrandingDto, actorId: string): Promise<Branding> {
    const society = await this.prisma.society.findFirst({ where: { id: societyId, deletedAt: null }, select: { id: true } });
    if (!society) throw new NotFoundException('Society not found');

    if (dto.primaryColor) {
      const ratio = contrastWithWhite(dto.primaryColor);
      if (ratio < MIN_CONTRAST_WITH_WHITE) {
        throw new BadRequestException(
          `That colour is too light: white text on it would be hard to read (contrast ${ratio.toFixed(1)}:1, needs ${MIN_CONTRAST_WITH_WHITE}:1). Pick a darker shade.`,
        );
      }
    }
    if (dto.logoDataUri) {
      const check = checkLogo(dto.logoDataUri);
      if (!check.ok) throw new BadRequestException(check.reason);
    }

    const current = await this.get(societyId);
    const next: Branding = {
      appName: dto.appName === undefined ? current.appName : dto.appName ? dto.appName : null,
      primaryColor: dto.primaryColor === undefined ? current.primaryColor : dto.primaryColor ? dto.primaryColor.toUpperCase() : null,
      logoDataUri: dto.logoDataUri === undefined ? current.logoDataUri : dto.logoDataUri ? dto.logoDataUri : null,
    };

    const row = await this.prisma.societyConfiguration.findUnique({ where: { societyId }, select: { additionalConfig: true } });
    const existing = (row?.additionalConfig as Record<string, unknown> | null) ?? {};
    const additionalConfig = { ...existing, branding: next } as unknown as Prisma.InputJsonValue;

    await this.prisma.societyConfiguration.upsert({
      where: { societyId },
      create: { societyId, additionalConfig },
      update: { additionalConfig },
    });

    await this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: AuditAction.CONFIG_CHANGED,
        entityType: 'SocietyConfiguration',
        entityId: societyId,
        // The logo itself is not written to the audit trail — only that it changed.
        oldValues: { appName: current.appName, primaryColor: current.primaryColor, hasLogo: !!current.logoDataUri } as Prisma.InputJsonValue,
        newValues: {
          action: 'BRANDING_UPDATED',
          appName: next.appName,
          primaryColor: next.primaryColor,
          hasLogo: !!next.logoDataUri,
        } as Prisma.InputJsonValue,
      },
    });

    return next;
  }
}
