import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ShopifyService } from '../shopify/shopify.service';

interface CustomizationData {
  x: number;
  y: number;
  zoom: number;
  shape: 'circle' | 'heart' | 'rectangle';
}

@Injectable()
export class CustomizerService {
  private readonly logger = new Logger(CustomizerService.name);
  private supabase: any;

  constructor(private readonly shopifyService: ShopifyService) {
    this.initializeSupabase();
  }

  /**
   * Initialize Supabase client with credentials from environment
   */
  private initializeSupabase(): void {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error(
          'Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) environment variables.',
        );
      }

      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.logger.log('Supabase Storage initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Supabase:', error);
      throw error;
    }
  }

  /**
   * Generate a unique session ID that doesn't conflict with existing Shopify orders
   * Returns both the session ID and the reason for any changes
   */
  private async generateUniqueSessionId(
    baseSessionId: string,
  ): Promise<{ sessionId: string; reason: string }> {
    try {
      // Fetch all orders from Shopify to check for conflicts
      const ordersResponse = await this.shopifyService.getOrders(250, 'any');
      const existingOrders = ordersResponse.orders || [];

      // Extract all note/description fields that might contain session IDs
      const usedSessionIds = new Set<string>();
      existingOrders.forEach((order: any) => {
        // Check if session ID appears in order notes or properties
        if (order.note && order.note.includes(baseSessionId)) {
          usedSessionIds.add(baseSessionId);
        }
      });

      // If the base session ID is not used, return it with reason
      if (!usedSessionIds.has(baseSessionId)) {
        return {
          sessionId: baseSessionId,
          reason: 'Session ID is available and not used in any orders',
        };
      }

      // Generate a new unique session ID by appending a random suffix
      let newSessionId = baseSessionId;
      let counter = 1;
      const maxAttempts = 100;

      while (usedSessionIds.has(newSessionId) && counter < maxAttempts) {
        // Generate with timestamp and random suffix
        const timestamp = Date.now().toString().slice(-4);
        const randomSuffix = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
        newSessionId = `${baseSessionId}_${timestamp}_${randomSuffix}`;
        counter++;
      }

      this.logger.log(
        `Session ID conflict detected. Original: ${baseSessionId}, New: ${newSessionId}`,
      );
      return {
        sessionId: newSessionId,
        reason: `Session ID conflict detected: "${baseSessionId}" is already used in existing orders. Generated new unique ID to avoid duplication.`,
      };
    } catch (error) {
      this.logger.warn(
        'Could not check Shopify orders for session ID conflicts, using original ID',
        error,
      );
      return {
        sessionId: baseSessionId,
        reason:
          'Could not verify with Shopify orders. Using original session ID.',
      };
    }
  }

  /**
   * Apply shape mask to image - creates clipped effect where image shows only in shape
   */
  private async applyShapeMask(
    imageBuffer: Buffer,
    width: number,
    height: number,
    shape: 'circle' | 'heart' | 'rectangle',
  ): Promise<Buffer> {
    try {
      // Resize image to target dimensions
      const resizedImage = await sharp(imageBuffer)
        .resize(width, height, { fit: 'cover' })
        .toBuffer();

      // Create the mask shape as an SVG
      let maskSvg: string;

      switch (shape) {
        case 'circle': {
          const radius = Math.min(width, height) / 2;
          const cx = width / 2;
          const cy = height / 2;
          maskSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${cx}" cy="${cy}" r="${radius}" fill="white"/>
          </svg>`;
          break;
        }
        case 'heart': {
          maskSvg = `<svg width="${width}" height="${height}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
            <path d="M50,90 C25,75 10,60 10,45 C10,30 20,20 30,20 C38,20 45,25 50,35 C55,25 62,20 70,20 C80,20 90,30 90,45 C90,60 75,75 50,90 Z" fill="white"/>
          </svg>`;
          break;
        }
        case 'rectangle': {
          const padding = Math.min(width, height) * 0.08;
          maskSvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect x="${padding}" y="${padding}" width="${width - padding * 2}" height="${height - padding * 2}" rx="10" fill="white"/>
          </svg>`;
          break;
        }
        default:
          throw new BadRequestException(`Invalid shape: ${shape}`);
      }

      // Render the mask SVG to a buffer with transparency
      const maskImage = await sharp(Buffer.from(maskSvg))
        .resize(width, height, { fit: 'fill', position: 'center' })
        .png()
        .toBuffer();

      // Create white background
      const whiteBg = await sharp({
        create: {
          width: width,
          height: height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer();

      // Composite: white background + resized image with mask applied
      const final = await sharp(whiteBg)
        .composite([
          {
            input: resizedImage,
            top: 0,
            left: 0,
            blend: 'over',
          },
          {
            input: maskImage,
            top: 0,
            left: 0,
            blend: 'dest-in', // Apply mask using dest-in blend mode
          },
        ])
        .png()
        .toBuffer();

      return final;
    } catch (error) {
      this.logger.error(`Failed to apply ${shape} mask:`, error);
      throw new BadRequestException(`Failed to apply ${shape} mask`);
    }
  }

  /**
   * Transform image based on customization data (x, y, zoom)
   */
  private async transformImage(
    imageBuffer: Buffer,
    customizationData: CustomizationData,
    outputWidth: number = 500,
    outputHeight: number = 500,
  ): Promise<Buffer> {
    try {
      // Clamp zoom between 0.1 and 5 to ensure valid transformations
      const zoom = Math.max(0.1, Math.min(5, customizationData.zoom));

      // x and y are percentages (0-100) representing the center position of the image
      const x = Math.max(0, Math.min(100, customizationData.x));
      const y = Math.max(0, Math.min(100, customizationData.y));

      // Calculate the scaled dimensions based on zoom
      const scaledWidth = Math.round(outputWidth * zoom);
      const scaledHeight = Math.round(outputHeight * zoom);

      // Calculate position where the scaled image should be placed
      const centerX = Math.round((x / 100) * outputWidth);
      const centerY = Math.round((y / 100) * outputHeight);

      // Calculate top-left corner of the image based on its center position
      const imageLeft = Math.round(centerX - scaledWidth / 2);
      const imageTop = Math.round(centerY - scaledHeight / 2);

      // Calculate the region to extract from the resized image
      // This ensures we only composite the portion that's visible on the canvas
      let extractLeft = 0;
      let extractTop = 0;
      let extractWidth = scaledWidth;
      let extractHeight = scaledHeight;

      // Adjust extract region if image extends beyond canvas boundaries
      if (imageLeft < 0) {
        extractLeft = Math.abs(imageLeft);
        extractWidth = scaledWidth - extractLeft;
      }
      if (imageTop < 0) {
        extractTop = Math.abs(imageTop);
        extractHeight = scaledHeight - extractTop;
      }

      // Ensure extract dimensions don't exceed output size
      extractWidth = Math.min(extractWidth, outputWidth);
      extractHeight = Math.min(extractHeight, outputHeight);

      // Resize and extract the visible portion of the image
      const croppedImage = await sharp(imageBuffer)
        .resize(scaledWidth, scaledHeight, { fit: 'cover' })
        .extract({
          left: extractLeft,
          top: extractTop,
          width: extractWidth,
          height: extractHeight,
        })
        .png()
        .toBuffer();

      // Calculate where to place the cropped image on the canvas
      const compositeLeft = Math.max(0, imageLeft);
      const compositeTop = Math.max(0, imageTop);

      // Create the final image by compositing the cropped image onto a white canvas
      const transformedImage = await sharp({
        create: {
          width: outputWidth,
          height: outputHeight,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .composite([
          {
            input: croppedImage,
            top: compositeTop,
            left: compositeLeft,
          },
        ])
        .png()
        .toBuffer();

      return transformedImage;
    } catch (error) {
      this.logger.error('Failed to transform image:', error);
      throw new BadRequestException('Failed to transform image');
    }
  }

  /**
   * Upload image with customization data
   * Saves two images: original and shaped/transformed version
   * Checks if session ID exists in Shopify orders and generates a new one if needed
   */
  async uploadSessionImage(
    sessionId: string,
    file: Express.Multer.File,
    customizationData: CustomizationData,
  ): Promise<{
    success: boolean;
    originalFileId: string;
    shapedFileId: string;
    originalUrl: string;
    shapedUrl: string;
    message: string;
    sessionIdUsed: string;
    sessionIdChanged: boolean;
    sessionIdChangeReason: string;
  }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    try {
      const allowedMimes = ['image/png', 'image/jpeg'];
      if (!allowedMimes.includes(file.mimetype)) {
        throw new BadRequestException('Only PNG and JPG files are allowed');
      }

      // Check if session ID conflicts with existing Shopify orders
      const originalSessionId = sessionId;
      const sessionIdResult = await this.generateUniqueSessionId(sessionId);
      const finalSessionId = sessionIdResult.sessionId;
      const sessionIdChangeReason = sessionIdResult.reason;
      const sessionIdChanged = originalSessionId !== finalSessionId;

      if (sessionIdChanged) {
        this.logger.log(
          `Session ID changed due to conflict. Original: ${originalSessionId}, Using: ${finalSessionId}. Reason: ${sessionIdChangeReason}`,
        );
      } else {
        this.logger.log(
          `Session ID validated: ${originalSessionId}. Reason: ${sessionIdChangeReason}`,
        );
      }

      const folderPath = `customizer/${finalSessionId}`;
      const originalFileName = 'original.png';
      const shapedFileName = `${customizationData.shape}.png`;

      const originalFilePath = `${folderPath}/${originalFileName}`;
      const shapedFilePath = `${folderPath}/${shapedFileName}`;

      this.logger.log(
        `Uploading customized image for session: ${finalSessionId} (shape: ${customizationData.shape})`,
      );

      // Delete existing files
      try {
        await this.supabase.storage
          .from('customizer-uploads')
          .remove([originalFilePath, shapedFilePath]);
      } catch (deleteError) {
        this.logger.debug(`No existing files to delete`);
      }

      // Upload original image
      const { error: originalUploadError } = await this.supabase.storage
        .from('customizer-uploads')
        .upload(originalFilePath, file.buffer, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: true,
        });

      if (originalUploadError) {
        throw new BadRequestException(
          `Failed to upload original image: ${originalUploadError.message}`,
        );
      }

      // Transform and apply shape mask
      const metadata = await sharp(file.buffer).metadata();
      const transformedImage = await this.transformImage(
        file.buffer,
        customizationData,
        500,
        500,
      );
      const shapedImage = await this.applyShapeMask(
        transformedImage,
        500,
        500,
        customizationData.shape,
      );

      // Upload shaped image
      const { error: shapedUploadError } = await this.supabase.storage
        .from('customizer-uploads')
        .upload(shapedFilePath, shapedImage, {
          contentType: 'image/png',
          cacheControl: '3600',
          upsert: true,
        });

      if (shapedUploadError) {
        throw new BadRequestException(
          `Failed to upload shaped image: ${shapedUploadError.message}`,
        );
      }

      // Get public URLs
      const { data: originalUrlData } = this.supabase.storage
        .from('customizer-uploads')
        .getPublicUrl(originalFilePath);

      const { data: shapedUrlData } = this.supabase.storage
        .from('customizer-uploads')
        .getPublicUrl(shapedFilePath);

      this.logger.log(
        `Successfully uploaded both images for session: ${finalSessionId}`,
      );

      return {
        success: true,
        originalFileId: originalFilePath,
        shapedFileId: shapedFilePath,
        originalUrl: originalUrlData?.publicUrl || '',
        shapedUrl: shapedUrlData?.publicUrl || '',
        message: 'Image customized and uploaded successfully',
        sessionIdUsed: finalSessionId,
        sessionIdChanged: sessionIdChanged,
        sessionIdChangeReason: sessionIdChangeReason,
      };
    } catch (error) {
      this.logger.error(
        `Failed to upload customized image for session ${sessionId}:`,
        error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to upload customized image');
    }
  }

  /**
   * Delete all files in a session folder
   */
  async deleteSessionFiles(sessionId: string): Promise<{
    success: boolean;
    message: string;
    filesDeleted: number;
  }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    try {
      const folderPath = `customizer/${sessionId}`;

      this.logger.log(`Deleting session folder: ${folderPath}`);

      const { data: files, error: listError } = await this.supabase.storage
        .from('customizer-uploads')
        .list(folderPath);

      if (listError) {
        this.logger.error(`Failed to list files: ${listError.message}`);
        throw new BadRequestException('Failed to list session files');
      }

      if (!files || files.length === 0) {
        return {
          success: true,
          message: 'No files to delete',
          filesDeleted: 0,
        };
      }

      const filePaths = files.map((file: any) => `${folderPath}/${file.name}`);
      const { error: deleteError } = await this.supabase.storage
        .from('customizer-uploads')
        .remove(filePaths);

      if (deleteError) {
        this.logger.error(`Failed to delete files: ${deleteError.message}`);
        throw new BadRequestException('Failed to delete session files');
      }

      this.logger.log(
        `Deleted ${files.length} files from session: ${sessionId}`,
      );

      return {
        success: true,
        message: `Session cleanup completed. ${files.length} files deleted.`,
        filesDeleted: files.length,
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete session files for ${sessionId}:`,
        error,
      );
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to delete session files');
    }
  }

  /**
   * Get session folder information
   */
  async getSessionInfo(sessionId: string): Promise<{
    sessionId: string;
    folderPath: string;
  }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    return {
      sessionId: sessionId,
      folderPath: `customizer/${sessionId}`,
    };
  }
}
