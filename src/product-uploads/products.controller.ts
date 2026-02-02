import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductUploadsService } from './product-uploads.service';
import { QrService } from '../qr/qr.service';
import { ShopifyService } from '../shopify/shopify.service';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Controller('products')
export class ProductsController {
  private logger = new Logger(ProductsController.name);
  private supabase: SupabaseClient | null = null;

  constructor(
    private readonly uploadsService: ProductUploadsService,
    private readonly qrService: QrService,
    private readonly shopifyService: ShopifyService,
  ) {
    this.initializeSupabase();
  }

  private initializeSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      this.logger.warn('Supabase credentials not configured');
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  }

  /**
   * Upload original image file (no customization, no scaling)
   * Complete flow in one endpoint!
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductImage(
    @UploadedFile() file: Express.Multer.File,
    @Body('productId') productId?: string,
    @Body('productName') productName?: string,
    @Body('sessionId') sessionId?: string,
    @Body('metadata') metadata?: string,
  ) {
    try {
      if (!file) {
        throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
      }

      const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowedMimes.includes(file.mimetype)) {
        throw new HttpException(
          'Only PNG and JPG files are allowed',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!this.supabase) {
        throw new HttpException(
          'Supabase service is not configured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Step 0: Check if sessionId already exists in database
      let isNewSession = true;
      let existingSessionCode: string | null = null;
      let sessionUpdateReason = '';

      if (sessionId) {
        // Check if this sessionId already has an upload record
        const existingUploads =
          await this.uploadsService.getUploadsBySession(sessionId);
        
        if (existingUploads.length > 0) {
          // Use the existing code from the first upload for this session
          existingSessionCode = existingUploads[0].code;
          isNewSession = false;
          sessionUpdateReason = `Updating existing session "${sessionId}" with code "${existingSessionCode}"`;
          
          // Remove old QR code from storage if exists
          const qrFilePath = `products/${existingSessionCode}/qr_code.png`;
          await this.supabase.storage
            .from('customizer-uploads')
            .remove([qrFilePath]);
        } else {
          sessionUpdateReason = `New session "${sessionId}" created`;
        }
      }

      // Step 1: Determine the code to use
      let shortCode: string;
      
      if (existingSessionCode) {
        // Reuse existing code for this session
        shortCode = existingSessionCode;
      } else {
        // Generate new short code for new sessions
        shortCode = this.generateShortCode();
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
          const { data: existingRecord } = await this.supabase
            .from('uploads')
            .select('code')
            .eq('code', shortCode)
            .single();

          if (!existingRecord) {
            break;
          }

          shortCode = this.generateShortCode();
          attempts++;
        }

        if (attempts >= maxAttempts) {
          throw new HttpException(
            'Could not generate unique code',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }

      // Step 2: Upload original image file (no customization or scaling)
      const fileExtension =
        file.originalname.endsWith('.jpg') ||
        file.originalname.endsWith('.jpeg')
          ? 'jpg'
          : 'png';
      const fileName = `${shortCode}.${fileExtension}`;
      const filePath = `products/${shortCode}/${fileName}`;

      this.logger.log(`Uploading original file for product code: ${shortCode}`);

      const { error: uploadError } = await this.supabase.storage
        .from('customizer-uploads')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw new HttpException(
          `Failed to upload file: ${uploadError.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Step 3: Get public URL
      const { data: urlData } = this.supabase.storage
        .from('customizer-uploads')
        .getPublicUrl(filePath);

      const imageUrl = urlData?.publicUrl || '';

      if (!imageUrl) {
        throw new HttpException(
          'Failed to get image URL',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      this.logger.log(`Image uploaded: ${imageUrl}`);

      // Step 4: Create or update upload record in database
      const metadataObj = metadata ? JSON.parse(metadata) : {};

      const uploadResult = await this.uploadsService.createOrUpdateUpload(
        imageUrl,
        sessionId,
        productId,
        productName,
        metadataObj,
        shortCode,
        !isNewSession,
      );

      this.logger.log(
        `Upload ${isNewSession ? 'created' : 'updated'}: ${shortCode}`,
      );

      // Step 5: Generate QR code with product URL
      const productUrl = `loretana.com/product/${shortCode}`;
      const qrResult = await this.qrService.saveQrCode(
        productUrl,
        sessionId || shortCode,
        { width: 400, errorCorrectionLevel: 'H' },
      );

      this.logger.log(`QR code generated: ${productUrl}`);

      return {
        success: true,
        message: isNewSession
          ? 'Product image uploaded and processed successfully'
          : 'Product image updated for existing session',
        code: shortCode,
        imageUrl: imageUrl,
        productUrl: productUrl,
        qrUrl: qrResult.qrUrl,
        qrFileId: qrResult.qrFileId,
        uploadId: uploadResult.uploadId,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        sessionId: sessionId,
        isNewSession: isNewSession,
        sessionUpdateReason: sessionUpdateReason,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to upload product image';
      this.logger.error(`Product upload error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get product by code - retrieve image and all data
   */
  @Get(':code')
  async getProductByCode(@Param('code') code: string) {
    try {
      if (!code) {
        throw new HttpException(
          'Code parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const uploadRecord = await this.uploadsService.getUploadByCode(code);

      if (!uploadRecord) {
        throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
      }

      return {
        success: true,
        code: uploadRecord.code,
        imageUrl: uploadRecord.imageUrl,
        productName: uploadRecord.productName,
        productId: uploadRecord.productId,
        metadata: uploadRecord.metadata,
        createdAt: uploadRecord.createdAt,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve product';
      this.logger.error(`Product retrieval error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Get QR code by sessionId - stream QR image bytes directly
   */
  @Get('session/:sessionId')
  async getProductBySessionId(
    @Param('sessionId') sessionId: string,
    @Res() res: any,
  ) {
    try {
      if (!sessionId) {
        throw new HttpException(
          'Session ID parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!this.supabase) {
        throw new HttpException(
          'Supabase service is not configured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const uploadRecords = await this.uploadsService.getUploadsBySession(sessionId);

      if (!uploadRecords || uploadRecords.length === 0) {
        throw new HttpException('Product not found for this session', HttpStatus.NOT_FOUND);
      }

      // Get the first (most recent) upload for this session
      const uploadRecord = uploadRecords[0];
      const filePath = `customizer/${sessionId}/qr_code.png`;

      // Download QR code image bytes from Supabase Storage
      const { data, error } = await this.supabase.storage
        .from('customizer-uploads')
        .download(filePath);

      if (error || !data) {
        throw new HttpException(
          `Failed to download QR code: ${error?.message || 'Unknown error'}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Set response headers and stream the QR code image
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="qr_code_${uploadRecord.code}.png"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(await data.arrayBuffer()));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to retrieve QR code';
      this.logger.error(`QR code retrieval error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Delete product and its image
   */
  @Delete(':code')
  async deleteProduct(@Param('code') code: string) {
    try {
      if (!code) {
        throw new HttpException(
          'Code parameter is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!this.supabase) {
        throw new HttpException(
          'Supabase service is not configured',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Delete from database
      await this.uploadsService.deleteUpload(code);

      // Delete image files from storage
      const { error: deleteError } = await this.supabase.storage
        .from('customizer-uploads')
        .remove([
          `products/${code}/${code}.png`,
          `products/${code}/qr_code.png`,
        ]);

      if (deleteError) {
        this.logger.warn(
          `Failed to delete storage files for ${code}: ${deleteError.message}`,
        );
      }

      return {
        success: true,
        message: 'Product deleted successfully',
        code,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to delete product';
      this.logger.error(`Product deletion error: ${errorMessage}`, error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Generate a short unique code (6-8 alphanumeric characters)
   */
  private generateShortCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
