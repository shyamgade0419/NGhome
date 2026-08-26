import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const SocietyId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request & { societyId?: string }>();
  return request.societyId;
});
