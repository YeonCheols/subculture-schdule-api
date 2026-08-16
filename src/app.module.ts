import { Module } from '@nestjs/common';
import { IngestAuthGuard } from './auth/ingest-auth.guard';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ImportController } from './events/import.controller';
import { HealthController } from './health.controller';
import { RedemptionCodesController } from './redemption-codes/redemption-codes.controller';
import { RedemptionCodesImportController } from './redemption-codes/redemption-codes-import.controller';
import { RedemptionCodesService } from './redemption-codes/redemption-codes.service';
import { StorageService } from './storage/storage.service';

@Module({
  controllers: [HealthController, EventsController, ImportController, RedemptionCodesController, RedemptionCodesImportController],
  providers: [StorageService, EventsService, RedemptionCodesService, IngestAuthGuard],
})
export class AppModule {}
