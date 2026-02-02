import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface QrOptions {
  width?: number;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

@Injectable()
export class QrService {
  private logger = new Logger(QrService.name);
  private supabase: SupabaseClient | null = null;
  private readonly defaultOptions: QrOptions = {
    width: 400,
    errorCorrectionLevel: 'H',
  };

  constructor() {
    this.initializeSupabase();
  }

  private initializeSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      this.logger.warn(
        'Supabase credentials not configured. QR code storage will be disabled.',
      );
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    this.logger.log('Supabase Storage initialized successfully');
  }

  async toBuffer(url: string, options?: QrOptions): Promise<Buffer> {
    try {
      if (!url || typeof url !== 'string') {
        throw new Error('URL must be a valid string');
      }

      const mergedOptions = { ...this.defaultOptions, ...options };

      this.logger.debug(`Generating QR code for URL: ${url}`);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const buffer = await QRCode.toBuffer(url, {
        type: 'png',
        errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
        width: mergedOptions.width,
      });

      this.logger.log(
        `QR code generated successfully (${buffer.length} bytes)`,
      );
      return buffer;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      this.logger.error(`Failed to generate QR code: ${errorMessage}`, error);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async saveQrCode(
    url: string,
    sessionId: string,
    options?: QrOptions,
  ): Promise<{ qrUrl: string; qrFileId: string }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Cannot save QR code.',
      );
    }

    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!url || typeof url !== 'string') {
      throw new BadRequestException('URL must be a valid string');
    }

    try {
      // Generate QR code buffer
      const qrBuffer = await this.toBuffer(url, options);

      const folderPath = `customizer/${sessionId}`;
      const qrFileName = 'qr_code.png';
      const qrFilePath = `${folderPath}/${qrFileName}`;

      this.logger.log(
        `Uploading QR code for session: ${sessionId}, URL: ${url}`,
      );

      // Upload QR code to Supabase
      const { error: uploadError } = await this.supabase.storage
        .from('customizer-uploads')
        .upload(qrFilePath, qrBuffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw new BadRequestException(
          `Failed to upload QR code: ${uploadError.message}`,
        );
      }

      // Get public URL
      const { data: qrUrlData } = this.supabase.storage
        .from('customizer-uploads')
        .getPublicUrl(qrFilePath);

      this.logger.log(
        `Successfully uploaded QR code for session: ${sessionId}`,
      );

      return {
        qrUrl: qrUrlData?.publicUrl || '',
        qrFileId: qrFilePath,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save QR code';
      this.logger.error(
        `Failed to save QR code for session ${sessionId}:`,
        error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Retrieve QR code image buffer for a given sessionId
   */
  async getQrCodeBySession(
    sessionId: string,
  ): Promise<{ buffer: Buffer; path: string }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Cannot retrieve QR code.',
      );
    }

    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    try {
      const folderPath = `customizer/${sessionId}`;
      const qrFileName = 'qr_code.png';
      const qrFilePath = `${folderPath}/${qrFileName}`;

      this.logger.log(`Retrieving QR code for session: ${sessionId}`);

      // Download QR code from Supabase
      const { data, error } = await this.supabase.storage
        .from('customizer-uploads')
        .download(qrFilePath);

      if (error || !data) {
        throw new BadRequestException(
          `QR code not found for session ${sessionId}: ${error?.message || 'No data returned'}`,
        );
      }

      const buffer = await data.arrayBuffer();
      this.logger.log(
        `Successfully retrieved QR code for session: ${sessionId}`,
      );

      return { buffer: Buffer.from(buffer), path: qrFilePath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve QR code';
      this.logger.error(
        `Failed to retrieve QR code for session ${sessionId}:`,
        error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }
}
