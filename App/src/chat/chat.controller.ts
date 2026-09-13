import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SocietyId } from '../common/decorators/society-id.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@ApiTags('Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Start (or resume) a 1:1 conversation with another resident in this society' })
  startConversation(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartConversationDto,
  ) {
    return this.chatService.getOrCreateConversation(societyId, user.id, dto.userId);
  }

  @Get('conversations')
  @ApiOperation({ summary: "List the caller's conversations, most recently active first" })
  listConversations(@SocietyId() societyId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.chatService.listConversations(societyId, user.id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Poll for messages in a conversation — newest first' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listMessages(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('page') page = 1,
    @Query('limit') limit = 30,
  ) {
    return this.chatService.listMessages(societyId, user.id, id, +page, +limit);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message' })
  sendMessage(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(societyId, user.id, id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Mark a conversation as read up to now, for the caller's own unread indicator" })
  async markRead(
    @SocietyId() societyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.chatService.markRead(societyId, user.id, id);
  }
}
