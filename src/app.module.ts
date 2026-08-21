import { Module } from '@nestjs/common';
import { IngestAuthGuard } from './auth/ingest-auth.guard';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { ImportController } from './events/import.controller';
import { HealthController } from './health.controller';
import { RedemptionCodesController } from './redemption-codes/redemption-codes.controller';
import { RedemptionCodesImportController } from './redemption-codes/redemption-codes-import.controller';
import { RedemptionCodesService } from './redemption-codes/redemption-codes.service';
import { RedemptionCodeCandidatesController } from './redemption-codes/redemption-code-candidates.controller';
import { RedemptionCodeCandidatesService } from './redemption-codes/redemption-code-candidates.service';
import { StorageService } from './storage/storage.service';
import { CharactersController } from './characters/characters.controller';
import { CharactersService } from './characters/characters.service';
import { EventImportsController } from './events/event-imports.controller';
import { EventImportsService } from './events/event-imports.service';
import { EventsV2Controller } from './events/events-v2.controller';
import { EventImportsAdminController } from './events/event-imports-admin.controller';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import { EventImportsAdminSessionController } from './events/event-imports-admin-session.controller';
import { EventImportsAdminPageController } from './events/event-imports-admin-page.controller';

@Module({
  controllers: [HealthController, EventsController, EventsV2Controller, ImportController, EventImportsController, EventImportsAdminController, EventImportsAdminSessionController, EventImportsAdminPageController, RedemptionCodesController, RedemptionCodesImportController, RedemptionCodeCandidatesController, CharactersController],
  providers: [StorageService, EventsService, EventImportsService, RedemptionCodesService, RedemptionCodeCandidatesService, CharactersService, IngestAuthGuard, AdminAuthGuard],
})
export class AppModule {}
