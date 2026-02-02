import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  HttpException,
  Logger,
  Headers,
  Res,
} from '@nestjs/common';
import express from 'express';
import { Readable } from 'stream';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomizerService } from './customizer.service';

@Controller('customizer')
export class CustomizerController {
  private readonly logger = new Logger(CustomizerController.name);

  constructor(private readonly customizerService: CustomizerService) {}

  /**
   * Upload image with customization data
   * POST /customizer/upload
   *
   * Form Data:
   * - file: PNG or JPG image file
   * - session: unique session ID (e.g., sess_abcd123)
   * - productId: product ID for folder organization
   * - x: horizontal position (0-100%)
   * - y: vertical position (0-100%)
   * - zoom: zoom level (0.5-3.0)
   * - shape: shape type (circle, heart, rectangle)
   * - shop (optional): shop domain for Shopify integration
   * - accessToken (optional): Shopify access token
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      session: string;
      productId: string;
      x: string;
      y: string;
      zoom: string;
      shape: string;
      shop?: string;
      accessToken?: string;
    },
  ): Promise<any> {
    try {
      // Accept multiple session field names for compatibility with various theme implementations
      const resolvedSession = body.session || (body as any).sessionId || (body as any).session_id || '';
      const resolvedProductId = body.productId || (body as any).product_id || '';

      this.logger.log(`Upload request received for session: ${resolvedSession}, productId: ${resolvedProductId}`);

      if (!resolvedSession) {
        throw new HttpException(
          'Session ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!resolvedProductId) {
        throw new HttpException(
          'Product ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!body.x || !body.y || !body.zoom || !body.shape) {
        throw new HttpException(
          'Missing required fields: x, y, zoom, shape',
          HttpStatus.BAD_REQUEST,
        );
      }

      // Parse customization data
      const customizationData = {
        x: parseFloat(body.x),
        y: parseFloat(body.y),
        zoom: parseFloat(body.zoom),
        shape: body.shape.toLowerCase(),
      };

      // Debug: log incoming customization payload and file info for QA
      try {
        this.logger.debug(
          `Incoming upload payload -> session=${resolvedSession} productId=${resolvedProductId} x=${customizationData.x} y=${customizationData.y} zoom=${customizationData.zoom} shape=${customizationData.shape} file=${file && file.originalname ? file.originalname : 'n/a'} size=${file && file.size ? file.size : 0}`,
        );
      } catch (e) {
        // swallow logging errors to avoid breaking upload flow
      }

      // Validate shape
      const validShapes = ['circle', 'heart', 'rectangle'];
      if (!validShapes.includes(customizationData.shape)) {
        throw new HttpException(
          `Invalid shape. Must be one of: ${validShapes.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadResult = await this.customizerService.uploadSessionImage(
        resolvedSession,
        resolvedProductId,
        file,
        customizationData as any,
      );

      // Optionally handle Shopify integration here
      if (body.shop && body.accessToken) {
        this.logger.debug(`Shopify integration detected - shop: ${body.shop}`);
        // TODO: Implement Shopify API calls if needed
      }

      return {
        statusCode: HttpStatus.CREATED,
        success: true,
        data: uploadResult,
        message: 'Image uploaded successfully',
      };
    } catch (error) {
      this.logger.error('Upload failed:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Upload failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Cleanup all files for a session
   * DELETE /customizer/cleanup/:sessionId
   *
   * Removes all files in the session folder and the folder itself
   */
  @Delete('cleanup/:sessionId')
  async cleanupSession(@Param('sessionId') sessionId: string): Promise<any> {
    try {
      this.logger.log(`Cleanup request received for session: ${sessionId}`);

      const result = await this.customizerService.deleteSessionFiles(sessionId);

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: result,
        message: 'Session files deleted successfully',
      };
    } catch (error) {
      this.logger.error(`Cleanup failed for session ${sessionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Cleanup failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get session folder information
   * POST /customizer/session/:sessionId
   *
   * Returns the session folder path
   */
  @Post('session/:sessionId')
  async getSessionInfo(@Param('sessionId') sessionId: string): Promise<any> {
    try {
      this.logger.log(`Session info request for: ${sessionId}`);

      const sessionInfo =
        await this.customizerService.getSessionInfo(sessionId);

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: sessionInfo,
        message: 'Session information retrieved',
      };
    } catch (error) {
      this.logger.error(`Failed to get session info for ${sessionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error
          ? error.message
          : 'Failed to retrieve session info',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get shaped image(s) public URL(s) for a sessionId.
   * Searches folders under `customizer/` matching `sessionId` or `sessionId-<productId>`
   * GET /customizer/shape/:sessionId
   */
  @Get('shape/:sessionId')
  async getShapeBySession(@Param('sessionId') sessionId: string): Promise<any> {
    try {
      this.logger.log(`Get shape request for session: ${sessionId}`);

      const result = await this.customizerService.getShapesBySession(
        sessionId,
      );

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: result,
        message: 'Shapes retrieved',
      };
    } catch (error) {
      this.logger.error(`Failed to get shapes for ${sessionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to retrieve shapes',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Return the latest shaped image for a sessionId.
   * GET /customizer/shape/:sessionId/latest
   */
  @Get('shape/:sessionId/latest')
  async getLatestShape(
    @Param('sessionId') sessionId: string,
    @Query('shape') shape: string,
    @Query('productId') productId: string,
    @Res() res: express.Response,
  ): Promise<any> {
    try {
      this.logger.log(`Get latest shape request for session: ${sessionId}`);
      const result = await this.customizerService.getLatestShapeBySession(
        sessionId,
        { shape: shape || undefined, productId: productId || undefined },
      );
      const publicUrl = result.publicUrl;

      // Proxy the image bytes from the public URL back to the client
      const fetchRes = await fetch(publicUrl);
      if (!fetchRes.ok || !fetchRes.body) {
        throw new HttpException('Failed to fetch image from storage', HttpStatus.BAD_GATEWAY);
      }

      const contentType = fetchRes.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache');

      // Convert web stream to node stream and pipe
      const nodeStream = Readable.fromWeb(fetchRes.body as any);
      nodeStream.pipe(res);
      return;
    } catch (error) {
      this.logger.error(`Failed to get latest shape for ${sessionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to retrieve latest shape',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Return the available shape types for a sessionId (circle, heart, rectangle).
   * GET /customizer/shape/:sessionId/types
   */
  @Get('shape/:sessionId/types')
  async getShapeTypes(@Param('sessionId') sessionId: string): Promise<any> {
    try {
      this.logger.log(`Get shape types request for session: ${sessionId}`);

      const result = await this.customizerService.getShapeTypesBySession(
        sessionId,
      );

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: result,
        message: 'Shape types retrieved',
      };
    } catch (error) {
      this.logger.error(`Failed to get shape types for ${sessionId}:`, error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Failed to retrieve shape types',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Run a cleanup job that deletes orphaned customizer folders older than a grace period.
   * POST /customizer/cleanup
   * Headers:
   *  - x-cleanup-secret: (required) a secret token set in `CLEANUP_SECRET` env var
   * Body (optional): { graceDays: number }
   */
  @Post('cleanup')
  async runCleanup(
    @Headers('x-cleanup-secret') secret: string,
    @Body() body: { graceDays?: number; force?: boolean },
  ): Promise<any> {
    try {
      const configured = process.env.CLEANUP_SECRET;
      if (!configured) {
        this.logger.warn(
          'CLEANUP_SECRET not configured; allowing cleanup without secret (development mode).',
        );
      } else {
        if (!secret || secret !== configured) {
          throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }
      }

      const graceDays = body?.graceDays || 7;
      const force = !!body?.force;

      if (force) {
        // require secret for destructive operation when configured
        const configuredSecret = process.env.CLEANUP_SECRET;
        if (configuredSecret) {
          if (!secret || secret !== configuredSecret) {
            throw new HttpException('Unauthorized for force cleanup', HttpStatus.UNAUTHORIZED);
          }
        } else {
          // If no secret configured, explicitly log a warning and allow (dev)
          this.logger.warn('Force cleanup requested but CLEANUP_SECRET not configured; proceeding (development mode).');
        }
      }

      const result = await this.customizerService.cleanupOrphanedSessions(
        graceDays,
        { force },
      );

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: result,
        message: 'Cleanup job completed',
      };
    } catch (error) {
      this.logger.error('Cleanup job failed:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error instanceof Error ? error.message : 'Cleanup failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete all customizer sessions (storage + related product uploads) not present in Shopify orders.
   * POST /customizer/delete-missing-orders
   * Headers: x-cleanup-secret (required when CLEANUP_SECRET configured)
   * Body: { force?: boolean }
   */
  @Post('delete-missing-orders')
  async deleteMissingSessions(
    @Headers('x-cleanup-secret') secret: string,
    @Body() body: { force?: boolean },
  ): Promise<any> {
    try {
      const configured = process.env.CLEANUP_SECRET;
      if (!configured) {
        this.logger.warn(
          'CLEANUP_SECRET not configured; allowing delete-missing-orders without secret (development mode).',
        );
      } else {
        if (!secret || secret !== configured) {
          throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }
      }

      const force = !!body?.force;

      const result = await this.customizerService.deleteSessionsNotInOrders({ force });

      return {
        statusCode: HttpStatus.OK,
        success: true,
        data: result,
        message: 'Delete missing sessions completed',
      };
    } catch (error) {
      this.logger.error('Delete missing sessions failed:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        error instanceof Error ? error.message : 'Delete missing sessions failed',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
