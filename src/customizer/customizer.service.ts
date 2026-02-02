import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ShopifyService } from '../shopify/shopify.service';
import { ProductUploadsService } from '../product-uploads/product-uploads.service';

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

  constructor(
    private readonly shopifyService: ShopifyService,
    private readonly productUploadsService: ProductUploadsService,
  ) {
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
        this.logger.warn(
          'Supabase credentials not configured. Supabase-dependent features will be disabled. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) environment variables.',
        );
        this.supabase = null;
        return;
      }

      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.logger.log('Supabase Storage initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Supabase:', error);
      // Do not throw here to avoid crashing the whole app during startup.
      this.supabase = null;
    }
  }

  /**
   * Generate a unique session ID that doesn't conflict with existing Shopify orders
   * Checks for both session_id AND product_id combination in order properties
   * Returns both the session ID and the reason for any changes
   */
  private async generateUniqueSessionId(
    baseSessionId: string,
    productId: string,
  ): Promise<{ sessionId: string; reason: string }> {
    try {
      // Fetch all orders from Shopify to check for conflicts
      const ordersResponse = await this.shopifyService.getOrders(250, 'any');
      const existingOrders = ordersResponse.orders || [];

      // Check if the combination of session_id and product_id exists in any order
      const conflictExists = existingOrders.some((order: any) => {
        const properties = order.properties || [];
        return properties.some(
          (prop: any) =>
            prop.name === 'session_id' &&
            prop.value === baseSessionId &&
            properties.some(
              (p: any) =>
                p.name === 'product_id' && p.value === productId,
            ),
        );
      });

      // If no conflict, return original session ID
      if (!conflictExists) {
        return {
          sessionId: baseSessionId,
          reason: `Session ID and Product ID combination is available and not used in any orders`,
        };
      }

      // Generate a new unique session ID by appending a random suffix
      let newSessionId = baseSessionId;
      let counter = 1;
      const maxAttempts = 100;

      while (counter < maxAttempts) {
        // Generate with timestamp and random suffix
        const timestamp = Date.now().toString().slice(-4);
        const randomSuffix = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();
        newSessionId = `${baseSessionId}_${timestamp}_${randomSuffix}`;

        // Check if new combination exists
        const newConflictExists = existingOrders.some((order: any) => {
          const properties = order.properties || [];
          return properties.some(
            (prop: any) =>
              prop.name === 'session_id' &&
              prop.value === newSessionId &&
              properties.some(
                (p: any) =>
                  p.name === 'product_id' && p.value === productId,
              ),
          );
        });

        if (!newConflictExists) {
          break;
        }
        counter++;
      }

      this.logger.log(
        `Session ID conflict detected for product ${productId}. Original: ${baseSessionId}, New: ${newSessionId}`,
      );
      return {
        sessionId: newSessionId,
        reason: `Conflict detected: session_id "${baseSessionId}" with product_id "${productId}" already exists in orders. Generated new unique session ID.`,
      };
    } catch (error) {
      this.logger.warn(
        `Could not check Shopify orders for session ID conflicts, using original ID`,
        error,
      );
      return {
        sessionId: baseSessionId,
        reason: `Could not verify with Shopify orders. Using original session ID.`,
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

      // Render the mask SVG to a PNG with alpha channel (white shape on transparent background)
      const maskImage = await sharp(Buffer.from(maskSvg))
        .resize(width, height, { fit: 'fill', position: 'center' })
        .ensureAlpha()
        .png()
        .toBuffer();

      // Composite: apply mask as alpha to the resized image (creates transparent areas where mask is black)
      const maskedImage = await sharp(resizedImage)
        .composite([
          {
            input: maskImage,
            top: 0,
            left: 0,
            blend: 'dest-in', // Use mask as alpha channel
          },
        ])
        .png()
        .toBuffer();

      // Create black background
      const blackBg = await sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      // Composite masked image onto black background
      const final = await sharp(blackBg)
        .composite([
          {
            input: maskedImage,
            top: 0,
            left: 0,
            blend: 'over',
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
   * Folder structure: customizer/sessionId-productId/
   * Flow:
   * 1. Check if session_id + product_id exists in Shopify orders; if yes, generate new session_id
   * 2. If not in orders, check if folder exists in storage; if yes, reuse and replace images
   * 3. If neither, create new folder with provided session_id
   */
  async uploadSessionImage(
    sessionId: string,
    productId: string,
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
    productIdUsed: string;
    sessionIdChanged: boolean;
    sessionIdChangeReason: string;
  }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!productId || productId.trim() === '') {
      throw new BadRequestException('Product ID is required');
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

      const originalSessionId = sessionId;
      let finalSessionId = sessionId;
      let sessionIdChangeReason = '';
      let sessionIdChanged = false;

      // Step 1: Check if session_id + product_id exists in Shopify orders
      const sessionIdResult = await this.generateUniqueSessionId(
        sessionId,
        productId,
      );
      finalSessionId = sessionIdResult.sessionId;
      sessionIdChangeReason = sessionIdResult.reason;
      sessionIdChanged = originalSessionId !== finalSessionId;

      if (sessionIdChanged) {
        this.logger.log(
          `Session ID conflict with Shopify orders for product ${productId}. Original: ${originalSessionId}, Generated new: ${finalSessionId}. Reason: ${sessionIdChangeReason}`,
        );
      } else {
        // Session ID + Product ID combination not in Shopify orders
        // Step 2: Check if folder already exists in storage
        const folderPath = `customizer/${sessionId}-${productId}`;
        const { data: existingFiles, error: listError } =
          await this.supabase.storage
            .from('customizer-uploads')
            .list(folderPath);

        if (existingFiles && existingFiles.length > 0) {
          // Folder exists, will reuse it and replace images
          sessionIdChangeReason = `Session ID + Product ID not in Shopify orders. Folder exists in storage, reusing and replacing existing images.`;
          this.logger.log(
            `Session ID valid (not in Shopify orders). Reusing existing session-product folder: ${folderPath}`,
          );
        } else {
          // No conflict and no existing folder - use normally
          sessionIdChangeReason = `Session ID + Product ID not in Shopify orders and no existing folder. Creating new upload.`;
          this.logger.log(
            `Session ID validated: ${originalSessionId}. No conflicts or existing storage.`,
          );
        }
      }

      // Use folder structure: customizer/sessionId-productId/
      const finalFolderPath = `customizer/${finalSessionId}-${productId}`;
      const originalFileName = 'original.png';
      // Use timestamp in shaped filename to ensure each upload gets a unique file
      const timestamp = Date.now();
      const shapedFileName = `${customizationData.shape}_${timestamp}.png`;

      const originalFilePath = `${finalFolderPath}/${originalFileName}`;
      const shapedFilePath = `${finalFolderPath}/${shapedFileName}`;

      this.logger.log(
        `Uploading customized image for session: ${finalSessionId}, product: ${productId} (shape: ${customizationData.shape})`,
      );

      // Delete all existing files in the session-product folder to ensure clean replacement
      try {
        const { data: existingFiles, error: listError } = await this.supabase.storage
          .from('customizer-uploads')
          .list(finalFolderPath);

        if (!listError && existingFiles && existingFiles.length > 0) {
          const filePaths = existingFiles.map(
            (f: any) => `${finalFolderPath}/${f.name}`,
          );
          const { error: deleteError } = await this.supabase.storage
            .from('customizer-uploads')
            .remove(filePaths);

          if (deleteError) {
            this.logger.warn(
              `Failed to delete old files for ${finalFolderPath}: ${deleteError.message}`,
            );
          } else {
            this.logger.log(
              `Deleted ${filePaths.length} old file(s) from ${finalFolderPath}`,
            );
          }
        }
      } catch (deleteError) {
        this.logger.debug(`Error during cleanup: ${deleteError}`);
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

      // The storefront now sends center-based percentages (0..100 where 50 === center).
      // Use the provided `customizationData` directly when transforming the image.
      const transformedImage = await this.transformImage(
        file.buffer,
        { x: customizationData.x, y: customizationData.y, zoom: customizationData.zoom, shape: customizationData.shape } as any,
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

      // Add aggressive cache-busting: use timestamp + random string to force fresh fetch
      const baseOriginalUrl = originalUrlData?.publicUrl || '';
      const baseShapedUrl = shapedUrlData?.publicUrl || '';
      const cacheBuster = `v=${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const originalUrlWithCacheBust = baseOriginalUrl
        ? `${baseOriginalUrl}${baseOriginalUrl.includes('?') ? '&' : '?'}${cacheBuster}`
        : '';
      const shapedUrlWithCacheBust = baseShapedUrl
        ? `${baseShapedUrl}${baseShapedUrl.includes('?') ? '&' : '?'}${cacheBuster}`
        : '';

      this.logger.log(
        `Successfully uploaded both images for session: ${finalSessionId}, product: ${productId}`,
      );

      return {
        success: true,
        originalFileId: originalFilePath,
        shapedFileId: shapedFilePath,
        originalUrl: originalUrlWithCacheBust,
        shapedUrl: shapedUrlWithCacheBust,
        message: 'Image customized and uploaded successfully',
        sessionIdUsed: finalSessionId,
        productIdUsed: productId,
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
   * Cleanup orphaned session-product folders older than `graceDays` and not referenced in any Shopify orders.
   * - Lists folders under `customizer/`
   * - For each folder, determines last-modified timestamp from contained files
   * - If older than grace period and not referenced in orders, deletes all files in that folder
   */
  async cleanupOrphanedSessions(
    graceDays: number = 7,
    options?: { force?: boolean },
  ): Promise<{
    deletedFolders: string[];
    skippedFolders: string[];
    errors: Array<{ folder: string; error: string }>;
  }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    const deletedFolders: string[] = [];
    const skippedFolders: string[] = [];
    const errors: Array<{ folder: string; error: string }> = [];

    try {
      // List top-level entries under customizer/ (should be per-session folders)
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        throw new Error(listRootError.message || 'Failed to list customizer root');
      }

      const ordersResponse = await this.shopifyService.getOrders(250, 'any');
      const existingOrders = ordersResponse.orders || [];

      const now = Date.now();
      const graceMs = graceDays * 24 * 60 * 60 * 1000;

      if (!entries || entries.length === 0) {
        return { deletedFolders, skippedFolders, errors };
      }

      const forceAll = !!options?.force;

      if (forceAll) {
        this.logger.warn('Force delete enabled: removing all folders under customizer');
      }

      // entries may represent folders (by name). Iterate each folder name
      for (const entry of entries) {
        const folderName = entry.name;
        const folderPath = `customizer/${folderName}`;

        try {
          const { data: files, error: listFilesError } = await this.supabase.storage
            .from('customizer-uploads')
            .list(folderPath);

          if (listFilesError) {
            errors.push({ folder: folderPath, error: listFilesError.message });
            continue;
          }

          if (!files || files.length === 0) {
            // Empty folder - delete (force and non-force both delete empty)
            const { error: removeError } = await this.supabase.storage
              .from('customizer-uploads')
              .remove([folderPath]);

            if (removeError) {
              errors.push({ folder: folderPath, error: removeError.message });
            } else {
              deletedFolders.push(folderPath);
            }
            continue;
          }

          // Determine last modified across files
          let latestTs = 0;
          for (const f of files) {
            const tsStr = f.updated_at || f.last_modified || f.created_at || f.timeCreated || f.metadata?.updated_at;
            if (tsStr) {
              const parsed = Date.parse(tsStr as string);
              if (!Number.isNaN(parsed)) {
                latestTs = Math.max(latestTs, parsed);
              }
            }
          }

          // If forceAll is true, delete without checking timestamps or orders
          if (forceAll) {
            const filePaths = files.map((f: any) => `${folderPath}/${f.name}`);
            const { error: deleteError } = await this.supabase.storage
              .from('customizer-uploads')
              .remove(filePaths);

            if (deleteError) {
              errors.push({ folder: folderPath, error: deleteError.message });
              continue;
            }

            deletedFolders.push(folderPath);
            continue;
          }

          if (latestTs === 0) {
            // If we couldn't determine timestamps, skip to be safe
            skippedFolders.push(folderPath);
            continue;
          }

          const ageMs = now - latestTs;
          if (ageMs <= graceMs) {
            skippedFolders.push(folderPath);
            continue;
          }

          // Extract sessionId from folder name (format: sessionId-productId or sessionId)
          const sessionId = folderName.split('-')[0];

          // Check orders for any reference to sessionId
          const isReferenced = existingOrders.some((order: any) => {
            try {
              const serialized = JSON.stringify(order);
              return serialized.includes(sessionId);
            } catch (e) {
              return false;
            }
          });

          if (isReferenced) {
            skippedFolders.push(folderPath);
            continue;
          }

          // Delete all files in the folder
          const filePaths = files.map((f: any) => `${folderPath}/${f.name}`);
          const { error: deleteError } = await this.supabase.storage
            .from('customizer-uploads')
            .remove(filePaths);

          if (deleteError) {
            errors.push({ folder: folderPath, error: deleteError.message });
            continue;
          }

          deletedFolders.push(folderPath);
        } catch (innerErr) {
          errors.push({ folder: folderPath, error: innerErr?.message || String(innerErr) });
        }
      }

      return { deletedFolders, skippedFolders, errors };
    } catch (error) {
      this.logger.error('Failed to run cleanup:', error);
      throw new BadRequestException('Cleanup job failed');
    }
  }

  /**
   * Delete all customizer folders whose sessionId is NOT referenced in any Shopify orders.
   * Also deletes any product upload DB records and product storage files that reference those sessions.
   */
  async deleteSessionsNotInOrders(options?: { force?: boolean }): Promise<{
    deletedFolders: string[];
    deletedUploads: string[];
    skippedFolders: string[];
    errors: Array<{ folder?: string; error: string }>;
  }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    const deletedFolders: string[] = [];
    const deletedUploads: string[] = [];
    const skippedFolders: string[] = [];
    const errors: Array<{ folder?: string; error: string }> = [];

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        throw new Error(listRootError.message || 'Failed to list customizer root');
      }

      if (!entries || entries.length === 0) {
        return { deletedFolders, deletedUploads, skippedFolders, errors };
      }

      const ordersResponse = await this.shopifyService.getOrders(250, 'any');
      const existingOrders = ordersResponse.orders || [];

      const forceAll = !!options?.force;

      for (const entry of entries) {
        const folderName = entry.name;
        const folderPath = `customizer/${folderName}`;

        try {
          // Extract base sessionId (prefix before '-')
          const sessionId = folderName.split('-')[0];

          if (!sessionId) {
            skippedFolders.push(folderPath);
            continue;
          }

          // Determine whether sessionId appears in any order
          const isReferenced = existingOrders.some((order: any) => {
            try {
              const serialized = JSON.stringify(order);
              return serialized.includes(sessionId);
            } catch (e) {
              return false;
            }
          });

          if (isReferenced && !forceAll) {
            skippedFolders.push(folderPath);
            continue;
          }

          // List files in the folder
          const { data: files, error: listFilesError } = await this.supabase.storage
            .from('customizer-uploads')
            .list(folderPath);

          if (listFilesError) {
            errors.push({ folder: folderPath, error: listFilesError.message });
            continue;
          }

          if (!files || files.length === 0) {
            // remove empty folder if possible
            const { error: removeError } = await this.supabase.storage
              .from('customizer-uploads')
              .remove([folderPath]);

            if (removeError) {
              errors.push({ folder: folderPath, error: removeError.message });
            } else {
              deletedFolders.push(folderPath);
            }
            continue;
          }

          // Delete files
          const filePaths = files.map((f: any) => `${folderPath}/${f.name}`);
          const { error: deleteError } = await this.supabase.storage
            .from('customizer-uploads')
            .remove(filePaths);

          if (deleteError) {
            errors.push({ folder: folderPath, error: deleteError.message });
            continue;
          }

          deletedFolders.push(folderPath);

          // Also delete product upload records that reference this sessionId
          try {
            const uploads = await this.productUploadsService.getUploadsBySession(sessionId);
            for (const u of uploads || []) {
              try {
                // Attempt to remove storage files for the product code
                if (this.supabase) {
                  await this.supabase.storage
                    .from('customizer-uploads')
                    .remove([
                      `products/${u.code}/${u.code}.png`,
                      `products/${u.code}/qr_code.png`,
                    ]);
                }

                await this.productUploadsService.deleteUpload(u.code);
                deletedUploads.push(u.code);
              } catch (innerDelErr) {
                errors.push({ folder: `product:${u.code}`, error: innerDelErr?.message || String(innerDelErr) });
              }
            }
          } catch (puErr) {
            // Log but continue
            this.logger.warn(`Failed to remove product uploads for session ${sessionId}:`, puErr);
          }
        } catch (innerErr) {
          errors.push({ folder: folderPath, error: innerErr?.message || String(innerErr) });
        }
      }

      return { deletedFolders, deletedUploads, skippedFolders, errors };
    } catch (error) {
      this.logger.error('Failed to delete sessions not in orders:', error);
      throw new BadRequestException('Failed to delete sessions not in orders');
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

  /**
   * Return shaped image public URLs for a sessionId.
   * Finds folders named `sessionId` or `sessionId-<productId>` and returns any pngs except `original.png`.
   */
  async getShapesBySession(sessionId: string): Promise<{
    sessionId: string;
    folders: Array<{
      folder: string;
      shapedFiles: Array<{ name: string; publicUrl: string }>;
    }>;
  }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        throw new Error(listRootError.message || 'Failed to list customizer root');
      }

      const matched = (entries || []).filter((e: any) => {
        if (!e || !e.name) return false;
        return e.name === sessionId || e.name.startsWith(`${sessionId}-`);
      });

      const folders: Array<any> = [];

      for (const entry of matched) {
        const folderName = entry.name;
        const folderPath = `customizer/${folderName}`;

        const { data: files, error: listFilesError } = await this.supabase.storage
          .from('customizer-uploads')
          .list(folderPath);

        if (listFilesError) {
          // skip folder on error
          continue;
        }

        const shapedFiles: Array<{ name: string; publicUrl: string }> = [];

        for (const f of files || []) {
          if (!f || !f.name) continue;
          if (f.name === 'original.png') continue;
          if (!f.name.toLowerCase().endsWith('.png')) continue;

          const filePath = `${folderPath}/${f.name}`;
          const { data: urlData } = this.supabase.storage
            .from('customizer-uploads')
            .getPublicUrl(filePath);

          const baseUrl = urlData?.publicUrl || '';
          const cacheBuster = `v=${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
          const publicUrl = baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${cacheBuster}` : '';

          if (publicUrl) {
            shapedFiles.push({ name: f.name, publicUrl });
          }
        }

        folders.push({ folder: folderPath, shapedFiles });
      }

      return { sessionId, folders };
    } catch (error) {
      this.logger.error(`Failed to fetch shapes for session ${sessionId}:`, error);
      throw new BadRequestException('Failed to fetch shaped images');
    }
  }

  /**
   * Return the single most-recent shaped image public URL for a sessionId.
   * Chooses the latest shaped PNG (excluding original.png) across folders matching sessionId.
   */
  async getLatestShapeBySession(
    sessionId: string,
    options?: { shape?: string; productId?: string },
  ): Promise<{
    sessionId: string;
    folder: string;
    name: string;
    publicUrl: string;
    timestamp: number;
  }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        throw new Error(listRootError.message || 'Failed to list customizer root');
      }

      const matched = (entries || []).filter((e: any) => {
        if (!e || !e.name) return false;
        return e.name === sessionId || e.name.startsWith(`${sessionId}-`);
      });

      // If productId specified, narrow to the specific folder if present
      const productId = options?.productId;
      let filteredMatched = matched;
      if (productId) {
        const exact = `${sessionId}-${productId}`;
        filteredMatched = matched.filter((e: any) => e.name === exact || e.name === sessionId);
      }

      let best: { folder: string; name: string; publicUrl: string; timestamp: number } | null = null;

      const knownShapes = new Set(['circle', 'heart', 'rectangle']);

      for (const entry of filteredMatched) {
        const folderName = entry.name;
        const folderPath = `customizer/${folderName}`;

        const { data: files, error: listFilesError } = await this.supabase.storage
          .from('customizer-uploads')
          .list(folderPath);

        if (listFilesError || !files) {
          continue;
        }

        for (const f of files) {
          if (!f || !f.name) continue;
          const lower = f.name.toLowerCase();
          if (lower === 'original.png') continue;
          if (!lower.endsWith('.png')) continue;

          // extract shape prefix from filename (before '_' or '-')
          const base = lower.split('.')[0];
          const m = base.match(/^([a-z]+)[_\-]?.*/i);
          const candidate = m ? m[1].toLowerCase() : '';
          if (!knownShapes.has(candidate)) {
            // skip non-shape files (e.g., qr_code.png)
            continue;
          }

          // If a specific shape was requested, enforce it
          if (options?.shape && options.shape.toLowerCase() !== candidate) {
            continue;
          }

          // Determine timestamp: prefer metadata fields from Supabase response
          let ts = 0;
          const possible = f.updated_at || f.last_modified || f.created_at || f.timeCreated || f.metadata?.updated_at;
          if (possible) {
            const parsed = Date.parse(possible as string);
            if (!Number.isNaN(parsed)) ts = parsed;
          }

          // Fallback: try to extract digits from filename (common shaped filename uses <shape>_<timestamp>.png)
          if (ts === 0) {
            const m = f.name.match(/(\d{10,})/);
            if (m) {
              const n = Number(m[1]);
              if (!Number.isNaN(n)) {
                // If looks like seconds, convert to ms; if long, assume ms
                ts = n < 1e12 ? n * 1000 : n;
              }
            }
          }

          // If still zero, set to epoch 0 so it won't be chosen over anything with a timestamp

          const filePath = `${folderPath}/${f.name}`;
          const { data: urlData } = this.supabase.storage
            .from('customizer-uploads')
            .getPublicUrl(filePath);

          const baseUrl = urlData?.publicUrl || '';
          if (!baseUrl) continue;
          const cacheBuster = `v=${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
          const publicUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${cacheBuster}`;

          if (!best || ts > best.timestamp) {
            best = { folder: folderPath, name: f.name, publicUrl, timestamp: ts };
          }
        }
      }

      if (!best) {
        throw new NotFoundException('No shaped image found for this session');
      }

      return { sessionId, folder: best.folder, name: best.name, publicUrl: best.publicUrl, timestamp: best.timestamp };
    } catch (error) {
      this.logger.error(`Failed to fetch latest shape for session ${sessionId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to fetch shaped image');
    }
  }

  /**
   * Return the set of shape types present for a sessionId.
   * Parses shaped filenames (expected format: <shape>[_|-]<timestamp>.png) and returns known shapes.
   */
  async getShapeTypesBySession(sessionId: string): Promise<{
    sessionId: string;
    shapes: string[];
    folders: Array<{ folder: string; shapes: string[] }>;
  }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('Session ID is required');
    }

    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      );
    }

    const knownShapes = new Set(['circle', 'heart', 'rectangle']);
    const foundShapes = new Set<string>();
    const folders: Array<{ folder: string; shapes: string[] }> = [];

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        throw new Error(listRootError.message || 'Failed to list customizer root');
      }

      const matched = (entries || []).filter((e: any) => {
        if (!e || !e.name) return false;
        return e.name === sessionId || e.name.startsWith(`${sessionId}-`);
      });

      for (const entry of matched) {
        const folderName = entry.name;
        const folderPath = `customizer/${folderName}`;

        const { data: files, error: listFilesError } = await this.supabase.storage
          .from('customizer-uploads')
          .list(folderPath);

        if (listFilesError || !files) {
          continue;
        }

        const shapesInFolder = new Set<string>();

        for (const f of files) {
          if (!f || !f.name) continue;
          const name = f.name.toLowerCase();
          if (name === 'original.png') continue;
          if (!name.endsWith('.png')) continue;

          // extract segment before first underscore or dash
          const base = name.split('.')[0];
          const m = base.match(/^([a-z]+)[_\-]?.*/i);
          if (!m) continue;
          const candidate = m[1].toLowerCase();
          if (knownShapes.has(candidate)) {
            shapesInFolder.add(candidate);
            foundShapes.add(candidate);
          }
        }

        folders.push({ folder: folderPath, shapes: Array.from(shapesInFolder) });
      }

      return { sessionId, shapes: Array.from(foundShapes), folders };
    } catch (error) {
      this.logger.error(`Failed to fetch shape types for session ${sessionId}:`, error);
      throw new BadRequestException('Failed to fetch shape types');
    }
  }
}
