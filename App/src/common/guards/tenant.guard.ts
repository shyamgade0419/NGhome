import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { IS_PLATFORM_ADMIN_KEY } from '../decorators/platform-admin.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiresPlatformAdmin = this.reflector.getAllAndOverride<boolean>(
      IS_PLATFORM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser; societyId: string }>();
    const user = request.user;

    if (!user) throw new UnauthorizedException();

    if (requiresPlatformAdmin) {
      if (!user.isPlatformAdmin) throw new ForbiddenException('Platform admin access required');
      return true;
    }

    // societyId always comes from the JWT — never from the request body
    const societyId = user.societyId;
    if (!societyId) {
      throw new ForbiddenException('No active society context');
    }

    // DB revalidation: membership must still be active and society must still be active.
    // This catches revoked memberships, deactivated accounts, and inactive societies
    // even when a valid JWT is still in circulation.
    if (user.membershipId) {
      const membership = await this.prisma.societyMembership.findFirst({
        where: {
          id: user.membershipId,
          userId: user.id,
          societyId,
          status: 'ACTIVE',
          user: { isActive: true },
          society: { isActive: true },
        },
      });

      if (!membership) {
        throw new ForbiddenException('Membership is no longer active');
      }
    }

    // Attach to request so controllers/services can read it via @SocietyId()
    request['societyId'] = societyId;

    return true;
  }
}
