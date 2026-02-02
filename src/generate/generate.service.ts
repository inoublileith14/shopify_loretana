import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SessionUploadService } from '../customizer/session-upload.service';
import { CustomizerService } from '../customizer/customizer.service';

@Injectable()
export class GenerateService {
  private readonly logger = new Logger(GenerateService.name);

  constructor(
    private readonly sessionUploadService: SessionUploadService,
    private readonly customizerService: CustomizerService,
  ) {}

  /**
   * Normalize incoming files map and delegate storage to SessionUploadService
   */
  async handleUpload(sessionId: string, fileMap: { [key: string]: Express.Multer.File[] }) {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('session/sessionId is required');
    }

    const files = {
      original: fileMap['original'] || fileMap['file'] || fileMap['image'],
      shape: fileMap['shape'] || fileMap['shaped'],
      qr: fileMap['qr'] || fileMap['qrcode'] || fileMap['code'],
    };

    this.logger.log(`GenerateService: storing files for session ${sessionId}`);

    return this.sessionUploadService.storeSessionFiles(sessionId, files);
  }

  /**
   * Return the public URL of the QR image for a session
   */
  async getQrUrl(sessionId: string) {
    return this.sessionUploadService.getQrPublicUrl(sessionId);
  }

  /**
   * Return QR file bytes and metadata
   */
  async getQrFile(sessionId: string) {
    return this.sessionUploadService.getQrFile(sessionId);
  }

  /**
   * Download original file bytes and metadata for a session
   */
  async getOriginalFile(sessionId: string) {
    return this.sessionUploadService.getOriginalFile(sessionId);
  }

  /**
   * Delete session folders that are not referenced in Shopify orders.
   * Accepts options: { force?: boolean }
   */
  async deleteOrphanedSessions(options?: { force?: boolean }) {
    return this.customizerService.deleteSessionsNotInOrders(options);
  }
}
