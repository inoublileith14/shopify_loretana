import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ProductUploadsService } from './product-uploads.service';

@Controller('uploads')
export class ProductUploadsController {
  private logger = new Logger(ProductUploadsController.name);

  constructor(private readonly uploadsService: ProductUploadsService) {}

  /**
   * Create an upload record with a short code
   */
  @Post()
  async createUpload(
    @Body('imageUrl') imageUrl: string,
    @Body('sessionId') sessionId?: string,
    @Body('productId') productId?: string,
    @Body('productName') productName?: string,
    @Body('metadata') metadata?: Record<string, any>,
  ) {
    try {
      if (!imageUrl) {
        throw new HttpException(
          'Image URL is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await this.uploadsService.createUpload(
        imageUrl,
        sessionId,
        productId,
        productName,
        metadata,
      );

      return {
        success: true,
        message: 'Upload record created successfully',
        code: result.code,
        uploadId: result.uploadId,
        qrUrl: result.qrUrl,
        shortUrl: `loretana.com/view/${result.code}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to create upload record';
      this.logger.error(`Upload creation error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get upload record by code
   */
  @Get(':code')
  async getUploadByCode(@Param('code') code: string) {
    try {
      if (!code) {
        throw new HttpException(
          'Code parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadRecord = await this.uploadsService.getUploadByCode(code);

      if (!uploadRecord) {
        throw new HttpException(
          'Upload record not found',
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: uploadRecord,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve upload record';
      this.logger.error(`Upload retrieval error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get all uploads for a session
   */
  @Get('session/:sessionId')
  async getUploadsBySession(@Param('sessionId') sessionId: string) {
    try {
      if (!sessionId) {
        throw new HttpException(
          'Session ID parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadRecords =
        await this.uploadsService.getUploadsBySession(sessionId);

      return {
        success: true,
        count: uploadRecords.length,
        data: uploadRecords,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve upload records';
      this.logger.error(
        `Session uploads retrieval error: ${errorMessage}`,
        error,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Update upload record with image URLs
   */
  @Post(':code/images')
  async updateUploadImages(
    @Param('code') code: string,
    @Body('originalImageUrl') originalImageUrl?: string,
    @Body('shapedImageUrl') shapedImageUrl?: string,
  ) {
    try {
      if (!code) {
        throw new HttpException(
          'Code parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.uploadsService.updateUploadImages(
        code,
        originalImageUrl,
        shapedImageUrl,
      );

      return {
        success: true,
        message: 'Upload record images updated successfully',
        code,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to update upload record';
      this.logger.error(`Upload update error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete an upload record
   */
  @Delete(':code')
  async deleteUpload(@Param('code') code: string) {
    try {
      if (!code) {
        throw new HttpException(
          'Code parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      await this.uploadsService.deleteUpload(code);

      return {
        success: true,
        message: 'Upload record deleted successfully',
        code,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to delete upload record';
      this.logger.error(`Upload deletion error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
