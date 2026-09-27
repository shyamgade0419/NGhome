import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';

/**
 * Read by every signed-in user's app (the global JwtAuthGuard applies; there
 * is no society or role check, so a platform-admin session can read it too).
 * Separate from PlatformController, whose routes are all platform-admin only.
 */
@ApiTags('Support')
@ApiBearerAuth()
@Controller('support')
export class SupportController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  @ApiOperation({ summary: 'Whether to show the optional support prompt, and where it pays' })
  info() {
    return this.platform.getSupportInfo();
  }
}
