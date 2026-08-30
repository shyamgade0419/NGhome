import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SelectSocietyDto } from './dto/select-society.dto';
import { RegisterSocietyDto } from './dto/register-society.dto';
import { JoinSocietyDto } from './dto/join-society.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with identifier (email or phone) and password',
    description:
      'Returns a fully scoped session when the user belongs to one society. ' +
      'Returns requiresSocietySelection=true + memberships[] when the user belongs to multiple societies.',
  })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @Public()
  @Post('register-society')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new society with admin account',
    description:
      'Public endpoint. Creates society, default configuration, admin user, and ' +
      'SOCIETY_ADMIN membership in a single database transaction. Returns a fully ' +
      'authenticated session for the new admin.',
  })
  @ApiResponse({ status: 201, description: 'Society registered and admin session created' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async registerSociety(@Body() dto: RegisterSocietyDto, @Req() req: Request) {
    return this.authService.registerSociety(
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @Public()
  @Post('join-society')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a resident and join a society via invite code',
    description:
      'Public endpoint. Validates the society join code, creates a User account ' +
      '(or re-uses an existing one with no membership in this society), creates a ' +
      'RESIDENT SocietyMembership linked to the chosen flat, and returns a fully ' +
      'scoped auth session. Membership is ACTIVE immediately; admin can remove ' +
      'non-legitimate joins from Settings → Roles.',
  })
  @ApiResponse({ status: 201, description: 'Resident registered and session created' })
  @ApiResponse({ status: 400, description: 'Invalid join code or flat' })
  @ApiResponse({ status: 409, description: 'Email already a member of this society' })
  async joinSociety(@Body() dto: JoinSocietyDto, @Req() req: Request) {
    return this.authService.joinSociety(
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('select-society')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Select active society after multi-society login',
    description:
      'Call this with the pre-selection token received from /auth/login when ' +
      'requiresSocietySelection=true. Returns a new society-scoped session.',
  })
  @ApiResponse({ status: 200, description: 'Society selected, scoped session issued' })
  @ApiResponse({ status: 403, description: 'Not a member of this society' })
  async selectSociety(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SelectSocietyDto,
    @Req() req: Request,
  ) {
    return this.authService.selectSociety(
      user.id,
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token (rotates refresh token)' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(
      dto,
      req.ip ?? undefined,
      req.headers['user-agent'] ?? undefined,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(@CurrentUser() user: AuthenticatedUser, @Body() dto: RefreshTokenDto) {
    await this.authService.logout(user.id, dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile and active membership context' })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id, user.membershipId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password (revokes all sessions)' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.authService.changePassword(user, dto);
    return { message: 'Password changed successfully' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset email',
    description: 'Always returns 200 — the response does not reveal whether the email is registered.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiResponse({ status: 400, description: 'Token invalid or expired' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset successfully. Please log in with your new password.' };
  }
}
