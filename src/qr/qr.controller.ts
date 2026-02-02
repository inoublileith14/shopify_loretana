import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  HttpException,
  HttpStatus,
  Logger,
  Body,
} from '@nestjs/common';
import type { Response } from 'express';
import { QrService } from './qr.service';
import { ShopifyService } from '../shopify/shopify.service';

@Controller('qr')
export class QrController {
  private logger = new Logger(QrController.name);

  constructor(
    private readonly qrService: QrService,
    private readonly shopifyService: ShopifyService,
  ) {}

  @Get()
  async getQr(
    @Query('url') url: string,
    @Res() res: Response,
    @Query('width') width?: string,
    @Query('errorCorrection') errorCorrection?: 'L' | 'M' | 'Q' | 'H',
  ) {
    try {
      if (!url || typeof url !== 'string') {
        throw new HttpException(
          'URL query parameter is required and must be a valid string',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Parse optional query parameters
      const options = {
        width: width ? parseInt(width, 10) : undefined,
        errorCorrectionLevel: errorCorrection,
      };

      this.logger.log(`QR code request for URL: ${url}`);

      const buffer = await this.qrService.toBuffer(url, options);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Length', buffer.length.toString());
      return res.send(buffer);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to generate QR code';
      this.logger.error(`QR generation error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('save')
  async saveQr(
    @Body('url') url: string,
    @Body('sessionId') sessionId: string,
    @Body('width') width?: number,
    @Body('errorCorrection') errorCorrection?: 'L' | 'M' | 'Q' | 'H',
  ) {
    try {
      if (!url || typeof url !== 'string') {
        throw new HttpException(
          'URL is required and must be a valid string',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!sessionId || typeof sessionId !== 'string') {
        throw new HttpException(
          'Session ID is required and must be a valid string',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Step 0: Check Shopify orders for sessionId conflict
      let sessionIdChanged = false;
      let sessionIdReason = '';
      let finalSessionId = sessionId;
      if (sessionId) {
        try {
          // Fetch all orders from Shopify
          const ordersResponse = await this.shopifyService.getOrders(
            250,
            'any',
          );
          const existingOrders = ordersResponse.orders || [];
          const usedSessionIds = new Set<string>();
          existingOrders.forEach((order: any) => {
            if (order.note && order.note.includes(sessionId)) {
              usedSessionIds.add(sessionId);
            }
          });
          if (usedSessionIds.has(sessionId)) {
            // Generate new sessionId
            const timestamp = Date.now().toString().slice(-4);
            const randomSuffix = Math.random()
              .toString(36)
              .substring(2, 8)
              .toUpperCase();
            finalSessionId = `${sessionId}_${timestamp}_${randomSuffix}`;
            sessionIdChanged = true;
            sessionIdReason = `Session ID conflict detected: "${sessionId}" is already used in existing orders. Generated new unique ID to avoid duplication.`;
          } else {
            sessionIdReason =
              'Session ID is available and not used in any orders';
          }
        } catch (error) {
          sessionIdReason =
            'Could not verify with Shopify orders. Using original session ID.';
        }
      }

      // Parse optional parameters
      const options = {
        width: width || undefined,
        errorCorrectionLevel: errorCorrection,
      };

      this.logger.log(
        `QR save request for URL: ${url}, Session: ${finalSessionId}`,
      );

      const result = await this.qrService.saveQrCode(
        url,
        finalSessionId,
        options,
      );

      return {
        success: true,
        message: 'QR code generated and saved successfully',
        qrUrl: result.qrUrl,
        qrFileId: result.qrFileId,
        sessionId: finalSessionId,
        sessionIdChanged,
        sessionIdReason,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save QR code';
      this.logger.error(`QR save error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Retrieve QR code image by sessionId
   * GET /qr/:sessionId
   * Returns the QR code image bytes (PNG)
   */
  @Get(':sessionId')
  async getQrBySession(@Param('sessionId') sessionId: string, @Res() res: Response) {
    try {
      if (!sessionId || typeof sessionId !== 'string') {
        throw new HttpException(
          'Session ID is required and must be a valid string',
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`QR retrieval request for session: ${sessionId}`);

      const result = await this.qrService.getQrCodeBySession(sessionId);

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Length', result.buffer.length.toString());
      return res.send(result.buffer);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve QR code';
      this.logger.error(`QR retrieval error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
