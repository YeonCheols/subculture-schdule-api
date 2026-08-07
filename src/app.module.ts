import { Module } from '@nestjs/common';
import { IngestAuthGuard } from './auth/ingest-auth.guard';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ImportController } from './events/import.controller';
import { HealthController } from './health.controller';
import { StorageService } from './storage/storage.service';

@Module({
  controllers: [HealthController, EventsController, ImportController],
  providers: [StorageService, EventsService, IngestAuthGuard],
})
export class AppModule {}
