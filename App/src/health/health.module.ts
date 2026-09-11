import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DocumentsModule } from '../documents/documents.module';
import { HealthController, DatabaseHealthIndicator } from './health.controller';

@Module({
  // DocumentsModule already exports SftpStorageService for PaymentsModule's
  // use; GET /health/storage reuses the exact same instance and its
  // existing checkStorage() rather than standing up a second one.
  imports: [TerminusModule, DocumentsModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
