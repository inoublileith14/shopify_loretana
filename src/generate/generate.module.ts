import { Module } from '@nestjs/common';
import { GenerateController } from './generate.controller';
import { SessionUploadModule } from '../customizer/session-upload.module';
import { GenerateService } from './generate.service';
import { CustomizerModule } from '../customizer/customizer.module';

@Module({
  imports: [SessionUploadModule, CustomizerModule],
  controllers: [GenerateController],
  providers: [GenerateService],
  exports: [GenerateService],
})
export class GenerateModule {}
