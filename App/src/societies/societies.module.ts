import { Module } from '@nestjs/common';
import { SocietiesService } from './societies.service';
import { SocietyPurgeService } from './society-purge.service';
import { SocietiesController } from './societies.controller';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  // DocumentsModule: the permanent delete removes a society's stored files.
  imports: [DocumentsModule],
  providers: [SocietiesService, SocietyPurgeService],
  controllers: [SocietiesController],
  exports: [SocietiesService],
})
export class SocietiesModule {}
