import { Controller, Post, UseInterceptors, UploadedFiles, Body, BadRequestException, Logger, Get, Param, Res, Delete, Query } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { GenerateService } from './generate.service';
import type { Response } from 'express';

@Controller('generate')
export class GenerateController {
  private readonly logger = new Logger(GenerateController.name);

  constructor(private readonly generateService: GenerateService) {}

  @Post('upload')
  @UseInterceptors(AnyFilesInterceptor())
  async upload(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    const sessionId = body.session || body.sessionId || body.session_id;
    if (!sessionId) {
      throw new BadRequestException('session/sessionId is required');
    }

    const fileMap: { [key: string]: Express.Multer.File[] } = {};
    for (const f of files || []) {
      const name = f.fieldname || 'original';
      if (!fileMap[name]) fileMap[name] = [];
      fileMap[name].push(f);
    }

    this.logger.log(`GenerateController: received ${files?.length || 0} files for session ${sessionId}`);

    return this.generateService.handleUpload(sessionId, fileMap);
  }

  @Get('qr/:sessionId')
  async getQr(@Param('sessionId') sessionId: string, @Res() res: Response) {
    try {
      if (!sessionId) {
        return res.status(400).json({ message: 'sessionId is required' });
      }

      const file = await this.generateService.getQrFile(sessionId);

      res.status(200);
      if (file.mimeType) res.type(file.mimeType);
      res.setHeader('Content-Length', String(file.buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
      res.send(file.buffer);
      return;
    } catch (err: any) {
      // Log the error server-side for debugging
      this.logger.error(`GET /generate/qr/${sessionId} failed:`, err?.stack || err);
      const status = err?.status || 500;
      const message = err?.message || 'Failed to fetch QR';
      return res.status(status).json({ message });
    }
  }

  @Get('original/:sessionId')
  async getOriginal(@Param('sessionId') sessionId: string, @Res() res: Response) {
    try {
      if (!sessionId) {
        return res.status(400).json({ message: 'sessionId is required' });
      }

      const file = await this.generateService.getOriginalFile(sessionId);

      res.status(200);
      if (file.mimeType) res.type(file.mimeType);
      res.setHeader('Content-Length', String(file.buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="${file.name}"`);
      res.send(file.buffer);
      return;
    } catch (err: any) {
      this.logger.error(`GET /generate/original/${sessionId} failed:`, err?.stack || err);
      const status = err?.status || 500;
      const message = err?.message || 'Failed to fetch original';
      return res.status(status).json({ message });
    }
  }

  @Delete('cleanup-orphans')
  async cleanupOrphans(@Query('force') force?: string) {
    const doForce = force === 'true' || force === '1';
    this.logger.log(`GenerateController: cleanup-orphans called (force=${doForce})`);
    const result = await this.generateService.deleteOrphanedSessions({ force: doForce });
    return result;
  }
}
