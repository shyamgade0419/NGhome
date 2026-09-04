import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SelectSocietyDto } from './dto/select-society.dto';
import { RegisterSocietyDto } from './dto/register-society.dto';
import { JoinSocietyDto } from './dto/join-society.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuditAction, SystemRole } from '@prisma/client';
import { generateJoinCode, generateUniqueJoinCode } from '../common/utils/join-code.util';

// ─── Canonical response shapes ────────────────────────────────────────────────

export interface MembershipDto {
  id: string;
  societyId: string;
  societyName: string;
  societyLogo: string | null;
  role: string;
  flatId: string | null;
  flatNumber: string | null;
  buildingName: string | null;
  status: string;
}

export interface UserDto {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  displayName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
  memberships: MembershipDto[];
  requiresSocietySelection?: boolean;
  /** True when the just-created membership is PENDING and needs admin
   *  approval before it grants access — see joinSociety(). The tokens
   *  returned alongside this carry no society context, so they let the
   *  caller log back in later but not into the app right now. */
  requiresApproval?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isEmail(value: string): boolean {
  return value.includes('@');
}

function buildUserDto(user: {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: `${user.firstName} ${user.lastName}`,
    isPlatformAdmin: user.isPlatformAdmin,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
  };
}

function buildMembershipDto(m: {
  id: string;
  societyId: string;
  role: string;
  flatId: string | null;
  status: string;
  society: { name: string; logoUrl: string | null };
  flat: { unitNumber: string; building: { name: string } | null } | null;
}): MembershipDto {
  return {
    id: m.id,
    societyId: m.societyId,
    societyName: m.society.name,
    societyLogo: m.society.logoUrl,
    role: m.role,
    flatId: m.flatId,
    flatNumber: m.flat?.unitNumber ?? null,
    buildingName: m.flat?.building?.name ?? null,
    status: m.status,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthResponse> {
    const identifier = dto.identifier.trim().toLowerCase();

    // Support email or phone login
    const user = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        ...(isEmail(identifier)
          ? { email: identifier }
          : { phone: identifier }),
      },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'PENDING'] } },
          include: {
            society: { select: { id: true, name: true, logoUrl: true, isActive: true } },
            flat: {
              select: {
                id: true, unitNumber: true,
                building: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const userDto = buildUserDto(user);

    // Platform admin — society-independent session
    if (user.isPlatformAdmin) {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        isPlatformAdmin: true,
      };
      const tokens = await this.generateTokens(payload, user.id, ipAddress, userAgent);
      await this.createAuditLog(user.id, undefined, AuditAction.LOGIN, ipAddress, userAgent);
      return { ...tokens, user: userDto, memberships: [] };
    }

    const activeMemberships = user.memberships.filter(
      (m) => m.society.isActive && m.status === 'ACTIVE',
    );

    if (activeMemberships.length === 0) {
      const hasPending = user.memberships.some((m) => m.status === 'PENDING' && m.society.isActive);
      if (hasPending) {
        throw new ForbiddenException(
          'Your request to join is still awaiting admin approval. Please check back later.',
        );
      }
      throw new ForbiddenException('No active society membership found');
    }

    // Caller pre-selected a specific society
    if (dto.societyId) {
      const membership = activeMemberships.find((m) => m.societyId === dto.societyId);
      if (!membership) throw new ForbiddenException('Not a member of this society');
      return this.issueScopedSession(user.id, userDto, membership, activeMemberships, ipAddress, userAgent);
    }

    // Single society — issue scoped session immediately
    if (activeMemberships.length === 1) {
      return this.issueScopedSession(user.id, userDto, activeMemberships[0], activeMemberships, ipAddress, userAgent);
    }

    // Multiple societies — issue a pre-selection token, return list for frontend
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isPlatformAdmin: false,
    };
    const tokens = await this.generateTokens(payload, user.id, ipAddress, userAgent);
    await this.createAuditLog(user.id, undefined, AuditAction.LOGIN, ipAddress, userAgent);

    return {
      ...tokens,
      user: userDto,
      memberships: activeMemberships.map(buildMembershipDto),
      requiresSocietySelection: true,
    };
  }

  async selectSociety(
    userId: string,
    dto: SelectSocietyDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');

    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId: dto.societyId, userId, status: 'ACTIVE' },
      include: {
        society: { select: { id: true, name: true, logoUrl: true, isActive: true } },
        flat: {
          select: {
            id: true, unitNumber: true,
            building: { select: { name: true } },
          },
        },
      },
    });
    if (!membership || !membership.society.isActive) {
      throw new ForbiddenException('Not an active member of this society');
    }

    // Fetch all active memberships for the response payload
    const allMemberships = await this.prisma.societyMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        society: { select: { id: true, name: true, logoUrl: true, isActive: true } },
        flat: {
          select: {
            id: true, unitNumber: true,
            building: { select: { name: true } },
          },
        },
      },
    });

    const userDto = buildUserDto(user);
    return this.issueScopedSession(
      userId,
      userDto,
      membership,
      allMemberships.filter((m) => m.society.isActive),
      ipAddress,
      userAgent,
    );
  }

  async registerSociety(
    dto: RegisterSocietyDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const email = dto.admin.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await argon2.hash(dto.admin.password);

    const result = await this.prisma.$transaction(async (tx) => {
      // Create society — generate a unique join code for resident self-registration
      const joinCode = await generateUniqueJoinCode(tx);
      const society = await tx.society.create({
        data: {
          name: dto.society.name,
          registrationNumber: dto.society.registrationNumber,
          address: dto.society.address,
          city: dto.society.city,
          state: dto.society.state,
          pincode: dto.society.pinCode,
          country: dto.society.country,
          email: dto.society.contactEmail,
          phone: dto.society.contactPhone,
          joinCode,
          joinCodeGeneratedAt: new Date(),
          configuration: { create: {} },
        },
      });

      // Create admin user
      const user = await tx.user.create({
        data: {
          email,
          phone: dto.admin.phone,
          firstName: dto.admin.firstName,
          lastName: dto.admin.lastName,
          passwordHash,
          isActive: true,
          emailVerified: false,
        },
      });

      // Create membership
      const membership = await tx.societyMembership.create({
        data: {
          societyId: society.id,
          userId: user.id,
          role: SystemRole.SOCIETY_ADMIN,
          status: 'ACTIVE',
          isPrimary: true,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          societyId: society.id,
          action: AuditAction.USER_CREATED,
          entityType: 'Society',
          entityId: society.id,
          newValues: { societyName: society.name, adminEmail: email } as Record<string, string>,
          ipAddress,
          userAgent,
        },
      });

      return { society, user, membership };
    });

    const { user, society, membership } = result;
    const userDto = buildUserDto(user);

    const membershipDto: MembershipDto = {
      id: membership.id,
      societyId: society.id,
      societyName: society.name,
      societyLogo: null,
      role: SystemRole.SOCIETY_ADMIN,
      flatId: null,
      flatNumber: null,
      buildingName: null,
      status: 'ACTIVE',
    };

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      isPlatformAdmin: false,
      societyId: society.id,
      role: SystemRole.SOCIETY_ADMIN,
      membershipId: membership.id,
    };

    const tokens = await this.generateTokens(payload, user.id, ipAddress, userAgent);
    return { ...tokens, user: userDto, memberships: [membershipDto] };
  }

  async refresh(dto: RefreshTokenDto, ipAddress?: string, userAgent?: string) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.isRevoked || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    if (!stored.user.isActive) {
      throw new UnauthorizedException('User account is inactive');
    }

    // Build new payload from DB record — never decode the opaque token
    const payload: JwtPayload = {
      sub: stored.user.id,
      email: stored.user.email,
      isPlatformAdmin: stored.user.isPlatformAdmin,
      societyId: stored.societyId ?? undefined,
      flatId: stored.flatId ?? undefined,
      role: (stored.role as JwtPayload['role']) ?? undefined,
      membershipId: stored.membershipId ?? undefined,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: this.configService.get<string>('jwt.accessExpiration'),
    });

    const newRefreshRaw = crypto.randomBytes(64).toString('hex');
    const newTokenHash = this.hashToken(newRefreshRaw);
    const expiresAt = this.parseExpiryDate(
      this.configService.get<string>('jwt.refreshExpiration') ?? '7d',
    );

    // Atomic rotation: revoke old and create new in a single transaction
    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { isRevoked: true },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.user.id,
          tokenHash: newTokenHash,
          expiresAt,
          ipAddress,
          userAgent,
          societyId: stored.societyId,
          membershipId: stored.membershipId,
          role: stored.role,
          flatId: stored.flatId,
        },
      }),
    ]);

    return { accessToken, refreshToken: newRefreshRaw };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash },
      data: { isRevoked: true },
    });
    await this.createAuditLog(userId, undefined, AuditAction.LOGOUT);
  }

  async updateProfile(
    userId: string,
    dto: { firstName?: string; lastName?: string; phone?: string },
  ) {
    const data: Record<string, string> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();

    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, phone: true, firstName: true, lastName: true, isActive: true, isPlatformAdmin: true, createdAt: true },
    });
    return { ...user, displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') };
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto): Promise<void> {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) throw new BadRequestException('User not found');

    const valid = await argon2.verify(dbUser.passwordHash, dto.currentPassword);
    if (!valid) throw new BadRequestException('Current password is incorrect');

    const newHash = await argon2.hash(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId: user.id },
      data: { isRevoked: true },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return success — never leak whether an email is registered
    if (!user || !user.isActive) return;

    // Invalidate any outstanding (unused, unexpired) tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, isUsed: false },
      data: { isUsed: true },
    });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    const appUrl = this.configService.get<string>('mail.appUrl');
    const resetUrl = `${appUrl}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.hashToken(dto.token);

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.isUsed || record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const newHash = await argon2.hash(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { isUsed: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId },
        data: { isRevoked: true },
      }),
    ]);
  }

  async getProfile(
    userId: string,
    activeMembershipId?: string,
  ): Promise<{ user: UserDto; memberships: MembershipDto[]; activeMembership: MembershipDto | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            society: { select: { id: true, name: true, logoUrl: true, isActive: true } },
            flat: {
              select: {
                id: true, unitNumber: true,
                building: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const activeMemberships = user.memberships.filter((m) => m.society.isActive);
    const membershipDtos = activeMemberships.map(buildMembershipDto);

    const activeMembership =
      membershipDtos.find((m) => m.id === activeMembershipId) ??
      membershipDtos[0] ??
      null;

    return {
      user: buildUserDto(user),
      memberships: membershipDtos,
      activeMembership,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async issueScopedSession(
    userId: string,
    userDto: UserDto,
    membership: {
      id: string;
      societyId: string;
      role: string;
      flatId: string | null;
      status: string;
      society: { name: string; logoUrl: string | null; isActive: boolean };
      flat: { id: string; unitNumber: string; building: { name: string } | null } | null;
    },
    allMemberships: Array<{
      id: string;
      societyId: string;
      role: string;
      flatId: string | null;
      status: string;
      society: { name: string; logoUrl: string | null; isActive: boolean };
      flat: { id: string; unitNumber: string; building: { name: string } | null } | null;
    }>,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const payload: JwtPayload = {
      sub: userId,
      email: userDto.email,
      isPlatformAdmin: false,
      societyId: membership.societyId,
      flatId: membership.flatId ?? undefined,
      role: membership.role as JwtPayload['role'],
      membershipId: membership.id,
    };

    const tokens = await this.generateTokens(payload, userId, ipAddress, userAgent);
    await this.createAuditLog(userId, membership.societyId, AuditAction.LOGIN, ipAddress, userAgent);

    return {
      ...tokens,
      user: userDto,
      memberships: allMemberships.map(buildMembershipDto),
    };
  }

  private async generateTokens(
    payload: JwtPayload,
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.accessSecret'),
      expiresIn: this.configService.get<string>('jwt.accessExpiration'),
    });

    const refreshTokenRaw = crypto.randomBytes(64).toString('hex');
    const tokenHash = this.hashToken(refreshTokenRaw);

    const expiresAt = this.parseExpiryDate(
      this.configService.get<string>('jwt.refreshExpiration') ?? '7d',
    );

    // Store JWT payload context so refresh can reconstruct the payload
    // without decoding the opaque refresh token.
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress,
        userAgent,
        societyId: payload.societyId,
        membershipId: payload.membershipId,
        role: payload.role,
        flatId: payload.flatId,
      },
    });

    return { accessToken, refreshToken: refreshTokenRaw };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Parse a duration string like "7d", "24h", "30m" into an absolute Date.
   * Falls back to 7 days if the format is unrecognised.
   */
  private parseExpiryDate(expiration: string): Date {
    const match = /^(\d+)([dhm])$/.exec(expiration.trim());
    const date = new Date();
    if (!match) {
      date.setDate(date.getDate() + 7);
      return date;
    }
    const value = parseInt(match[1], 10);
    switch (match[2]) {
      case 'd': date.setDate(date.getDate() + value); break;
      case 'h': date.setHours(date.getHours() + value); break;
      case 'm': date.setMinutes(date.getMinutes() + value); break;
    }
    return date;
  }

  // ─── Resident join-society ─────────────────────────────────────────────────

  /**
   * Register a new resident via the society's invite code.
   * Creates: User (if new) + SocietyMembership (RESIDENT, ACTIVE).
   * Issues a fully scoped session so the resident lands in the app immediately.
   *
   * If the email already exists globally but has no membership in this society,
   * a membership is added to the existing account. The supplied password is
   * ignored in that case — the resident uses their existing password.
   */
  async joinSociety(
    dto: JoinSocietyDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<AuthResponse> {
    const code = dto.joinCode.toUpperCase().trim();

    // 1. Resolve society by join code
    const society = await this.prisma.society.findUnique({
      where: { joinCode: code },
    });
    if (!society || !society.isActive || society.deletedAt) {
      throw new BadRequestException(
        'Join code not found or expired. Ask your admin for the current code.',
      );
    }

    // 2. Validate the flat belongs to this society and exists
    const flat = await this.prisma.flat.findFirst({
      where: { id: dto.flatId, societyId: society.id, deletedAt: null, isActive: true },
      include: { building: { select: { name: true } } },
    });
    if (!flat) {
      throw new BadRequestException(
        'The selected flat does not exist in this society.',
      );
    }

    const email = dto.email.trim().toLowerCase();

    // 3. Guard against duplicate memberships
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: { where: { societyId: society.id } },
      },
    });

    if (existingUser?.memberships?.length) {
      throw new ConflictException(
        'An account with this email is already a member of this society. Please log in.',
      );
    }

    const passwordHash = await argon2.hash(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      // Create user if first-time registrant
      let user = existingUser;
      if (!user) {
        user = await tx.user.create({
          data: {
            email,
            phone: dto.phone,
            firstName: dto.firstName,
            lastName: dto.lastName,
            passwordHash,
            isActive: true,
            emailVerified: false,
          },
          include: { memberships: true },
        });
      }

      // Only the first ACTIVE resident on a flat is primary. This used to be
      // hardcoded true, so a spouse or tenant joining the same flat after
      // someone else already had — a case the schema explicitly supports,
      // one SocietyMembership row per (society, user, flat) — would also
      // become "primary", leaving the flat with two, and anything that
      // assumes exactly one (e.g. WhatsApp billing reminders, which query
      // `isPrimary: true` and take the first match) would pick one
      // arbitrarily rather than the one actually meant to be the contact.
      const existingActiveOnFlat = await tx.societyMembership.count({
        where: { flatId: flat.id, status: 'ACTIVE' },
      });

      // The join code is the ONLY gate on this endpoint — anyone who has it
      // can pick any flat, including one that already belongs to a
      // different, unrelated resident. A flat's first claimant is trusted
      // instantly (there's nothing to arbitrate yet); anyone joining a flat
      // that already has an active resident goes to PENDING instead, so an
      // admin reviews it (approve — spouse/tenant/co-owner — or reject)
      // before that person can see the flat's bills or statements.
      const isFirstClaimant = existingActiveOnFlat === 0;

      // Create RESIDENT membership
      const membership = await tx.societyMembership.create({
        data: {
          societyId: society.id,
          userId: user.id,
          flatId: flat.id,
          role: SystemRole.RESIDENT,
          status: isFirstClaimant ? 'ACTIVE' : 'PENDING',
          isPrimary: isFirstClaimant,
        },
      });

      // Audit trail so admin can review new joins
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          societyId: society.id,
          action: AuditAction.USER_CREATED,
          entityType: 'SocietyMembership',
          entityId: membership.id,
          newValues: {
            email,
            flatCode: flat.flatCode,
            method: 'join_code',
            status: membership.status,
          } as Record<string, string>,
          ipAddress,
          userAgent,
        },
      });

      return { user, membership, isFirstClaimant };
    });

    const userDto = buildUserDto(result.user);
    const membershipDto: MembershipDto = {
      id: result.membership.id,
      societyId: society.id,
      societyName: society.displayName ?? society.name,
      societyLogo: society.logoUrl,
      role: SystemRole.RESIDENT,
      flatId: flat.id,
      flatNumber: flat.unitNumber,
      buildingName: flat.building?.name ?? null,
      status: result.membership.status,
    };

    // A PENDING join gets tokens with no society context at all — same
    // shape as the "multiple societies, none selected yet" case below —
    // so the caller can still be logged in as a *user* (e.g. to check
    // status later) but TenantGuard rejects every society-scoped request
    // until an admin approves and the membership actually becomes ACTIVE.
    const payload: JwtPayload = result.isFirstClaimant
      ? {
          sub: result.user.id,
          email: result.user.email,
          isPlatformAdmin: false,
          societyId: society.id,
          role: SystemRole.RESIDENT,
          membershipId: result.membership.id,
          flatId: flat.id,
        }
      : {
          sub: result.user.id,
          email: result.user.email,
          isPlatformAdmin: false,
        };

    const tokens = await this.generateTokens(payload, result.user.id, ipAddress, userAgent);
    return {
      ...tokens,
      user: userDto,
      memberships: [membershipDto],
      requiresApproval: !result.isFirstClaimant,
    };
  }

  // ─── Join code helpers ──────────────────────────────────────────────────────

  /** Public wrapper so SocietiesService can call this without importing AuthService. */
  generateJoinCode(): string {
    return generateJoinCode();
  }

  async generateUniqueJoinCode(tx?: Pick<typeof this.prisma, 'society'>): Promise<string> {
    return generateUniqueJoinCode(tx ?? this.prisma);
  }

  private async createAuditLog(
    actorId: string,
    societyId: string | undefined,
    action: AuditAction,
    ipAddress?: string,
    userAgent?: string,
  ) {
    await this.prisma.auditLog.create({
      data: { actorId, societyId, action, ipAddress, userAgent },
    });
  }
}
