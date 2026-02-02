import { Module } from '@nestjs/common';
import { SessionUploadController } from './session-upload.controller';
import { SessionUploadService } from './session-upload.service';

@Module({
  controllers: [SessionUploadController],
  providers: [SessionUploadService],
  exports: [SessionUploadService],
})
export class SessionUploadModule {}
