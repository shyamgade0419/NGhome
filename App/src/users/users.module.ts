import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UserDeleteService } from './user-delete.service';
import { UsersController } from './users.controller';

@Module({
  providers: [UsersService, UserDeleteService],
  controllers: [UsersController],
  exports: [UsersService, UserDeleteService],
})
export class UsersModule {}
