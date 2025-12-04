import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
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
      x: string;
      y: string;
      zoom: string;
      shape: string;
      shop?: string;
      accessToken?: string;
    },
  ): Promise<any> {
    try {
      this.logger.log(`Upload request received for session: ${body.session}`);

      if (!body.session) {
        throw new HttpException(
          'Session ID is required',
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

      // Validate shape
      const validShapes = ['circle', 'heart', 'rectangle'];
      if (!validShapes.includes(customizationData.shape)) {
        throw new HttpException(
          `Invalid shape. Must be one of: ${validShapes.join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadResult = await this.customizerService.uploadSessionImage(
        body.session,
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
}
