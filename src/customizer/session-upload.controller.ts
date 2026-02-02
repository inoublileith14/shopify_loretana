import { Controller, Post, UseInterceptors, UploadedFiles, Body, BadRequestException, Logger } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { SessionUploadService } from './session-upload.service';

@Controller('customizer/session-upload')
export class SessionUploadController {
  private readonly logger = new Logger(SessionUploadController.name);

  constructor(private readonly sessionUploadService: SessionUploadService) {}

  @Post()
  @UseInterceptors(AnyFilesInterceptor())
  async uploadSessionFiles(@UploadedFiles() files: Express.Multer.File[], @Body() body: any) {
    const sessionId = body.session || body.sessionId || body.session_id;
    if (!sessionId) {
      throw new BadRequestException('session/sessionId is required');
    }

    // Normalize files into named buckets expected by the service
    const fileMap: { [key: string]: Express.Multer.File[] } = {};
    for (const f of files || []) {
      const name = f.fieldname || 'original';
      if (!fileMap[name]) fileMap[name] = [];
      fileMap[name].push(f);
    }

    this.logger.log(`Received ${files?.length || 0} files for session ${sessionId}`);

    return this.sessionUploadService.storeSessionFiles(sessionId, {
      original: fileMap['original'] || fileMap['file'] || fileMap['image'],
      shape: fileMap['shape'] || fileMap['shaped'],
      qr: fileMap['qr'] || fileMap['qrcode'] || fileMap['code'],
    });
  }
}
