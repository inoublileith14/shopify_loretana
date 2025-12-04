import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface UploadRecord {
  id: string;
  code: string;
  sessionId?: string;
  imageUrl: string;
  originalImageUrl?: string;
  shapedImageUrl?: string;
  productId?: string;
  productName?: string;
  productImageUrl?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  expiresAt?: string;
}

@Injectable()
export class ProductUploadsService {
  private logger = new Logger(ProductUploadsService.name);
  private supabase: SupabaseClient | null = null;

  constructor() {
    this.initializeSupabase();
  }

  private initializeSupabase() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      this.logger.warn(
        'Supabase credentials not configured. Product uploads will be disabled.',
      );
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    this.logger.log('Supabase initialized for product uploads');
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

  /**
   * Create or update an upload record
   * If isUpdate is true, updates the existing record; otherwise creates a new one
   */
  async createOrUpdateUpload(
    imageUrl: string,
    sessionId?: string,
    productId?: string,
    productName?: string,
    metadata?: Record<string, any>,
    code?: string,
    isUpdate: boolean = false,
  ): Promise<{ uploadId: string; qrUrl: string }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Cannot create or update upload record.',
      );
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new BadRequestException(
        'Image URL is required and must be a string',
      );
    }

    try {
      const finalCode = code;
      if (!finalCode) {
        throw new BadRequestException('Code is required');
      }

      let uploadId: string;

      if (isUpdate && sessionId) {
        // First, fetch the existing record to get its ID
        const { data: existingRecord, error: fetchError } = await this.supabase
          .from('uploads')
          .select('id')
          .eq('code', finalCode)
          .single();

        if (fetchError || !existingRecord) {
          throw new BadRequestException(
            `Failed to find upload record for code: ${finalCode}`,
          );
        }

        uploadId = existingRecord.id;

        // Now update the record
        const { error: updateError } = await this.supabase
          .from('uploads')
          .update({
            image_url: imageUrl,
            product_id: productId,
            product_name: productName,
            metadata: metadata || {},
          })
          .eq('code', finalCode);

        if (updateError) {
          throw new BadRequestException(
            `Failed to update upload record: ${updateError.message}`,
          );
        }

        this.logger.log(
          `Upload record updated: Code=${finalCode}, SessionId=${sessionId}`,
        );
      } else {
        // Create new record
        const { data: insertData, error: insertError } = await this.supabase
          .from('uploads')
          .insert({
            code: finalCode,
            session_id: sessionId,
            image_url: imageUrl,
            product_id: productId,
            product_name: productName,
            metadata: metadata || {},
          })
          .select('id')
          .single();

        if (insertError) {
          throw new BadRequestException(
            `Failed to create upload record: ${insertError.message}`,
          );
        }

        uploadId = insertData.id;
        this.logger.log(
          `Upload record created: Code=${finalCode}, SessionId=${sessionId}`,
        );
      }

      const qrUrl = `loretana.com/view/${finalCode}`;

      return {
        uploadId,
        qrUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to create or update upload record';
      this.logger.error(`Error creating/updating upload record:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Create an upload record and return the short code
   */
  async createUpload(
    imageUrl: string,
    sessionId?: string,
    productId?: string,
    productName?: string,
    metadata?: Record<string, any>,
    code?: string,
  ): Promise<{ code: string; uploadId: string; qrUrl: string }> {
    if (!this.supabase) {
      throw new BadRequestException(
        'Supabase service is not configured. Cannot create upload record.',
      );
    }

    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new BadRequestException(
        'Image URL is required and must be a string',
      );
    }

    try {
      let finalCode = code || this.generateShortCode();
      let attempts = 0;
      const maxAttempts = 10;

      // Ensure code is unique (skip if code was provided as it's pre-validated)
      if (!code) {
        while (attempts < maxAttempts) {
          const { data: existingRecord } = await this.supabase
            .from('uploads')
            .select('code')
            .eq('code', finalCode)
            .single();

          if (!existingRecord) {
            break; // Code is unique
          }

          finalCode = this.generateShortCode();
          attempts++;
        }

        if (attempts >= maxAttempts) {
          throw new Error('Could not generate unique code after 10 attempts');
        }
      }

      // Insert the upload record
      const { data: uploadRecord, error: insertError } = await this.supabase
        .from('uploads')
        .insert({
          code: finalCode,
          session_id: sessionId,
          image_url: imageUrl,
          product_id: productId,
          product_name: productName,
          metadata: metadata || {},
        })
        .select('id')
        .single();

      if (insertError) {
        throw new BadRequestException(
          `Failed to create upload record: ${insertError.message}`,
        );
      }

      const qrUrl = `loretana.com/view/${finalCode}`;

      this.logger.log(
        `Upload record created: Code=${finalCode}, SessionId=${sessionId}, ProductId=${productId}`,
      );

      return {
        code: finalCode,
        uploadId: uploadRecord.id,
        qrUrl,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to create upload record';
      this.logger.error(`Error creating upload record:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Get upload record by short code
   */
  async getUploadByCode(code: string): Promise<UploadRecord | null> {
    if (!this.supabase) {
      throw new BadRequestException('Supabase service is not configured.');
    }

    if (!code || typeof code !== 'string') {
      throw new BadRequestException('Code is required and must be a string');
    }

    try {
      const { data: uploadRecord, error: queryError } = await this.supabase
        .from('uploads')
        .select('*')
        .eq('code', code.toUpperCase())
        .single();

      if (queryError) {
        if (queryError.code === 'PGRST116') {
          // Not found
          this.logger.debug(`Upload record not found for code: ${code}`);
          return null;
        }
        throw queryError;
      }

      this.logger.log(`Retrieved upload record for code: ${code}`);

      return {
        id: uploadRecord.id,
        code: uploadRecord.code,
        sessionId: uploadRecord.session_id,
        imageUrl: uploadRecord.image_url,
        originalImageUrl: uploadRecord.original_image_url,
        shapedImageUrl: uploadRecord.shaped_image_url,
        productId: uploadRecord.product_id,
        productName: uploadRecord.product_name,
        productImageUrl: uploadRecord.product_image_url,
        metadata: uploadRecord.metadata,
        createdAt: uploadRecord.created_at,
        expiresAt: uploadRecord.expires_at,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve upload record';
      this.logger.error(`Error retrieving upload record:`, error);
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Update upload record with additional image URLs
   */
  async updateUploadImages(
    code: string,
    originalImageUrl?: string,
    shapedImageUrl?: string,
  ): Promise<void> {
    if (!this.supabase) {
      throw new BadRequestException('Supabase service is not configured.');
    }

    try {
      const updateData: Record<string, any> = {};
      if (originalImageUrl) updateData.original_image_url = originalImageUrl;
      if (shapedImageUrl) updateData.shaped_image_url = shapedImageUrl;

      if (Object.keys(updateData).length === 0) {
        return;
      }

      const { error: updateError } = await this.supabase
        .from('uploads')
        .update(updateData)
        .eq('code', code.toUpperCase());

      if (updateError) {
        throw new BadRequestException(
          `Failed to update upload record: ${updateError.message}`,
        );
      }

      this.logger.log(`Updated upload record images for code: ${code}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to update upload record';
      this.logger.error(`Error updating upload record:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Get all uploads for a session
   */
  async getUploadsBySession(sessionId: string): Promise<UploadRecord[]> {
    if (!this.supabase) {
      throw new BadRequestException('Supabase service is not configured.');
    }

    if (!sessionId || typeof sessionId !== 'string') {
      throw new BadRequestException('Session ID is required');
    }

    try {
      const { data: uploadRecords, error: queryError } = await this.supabase
        .from('uploads')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false });

      if (queryError) {
        throw queryError;
      }

      this.logger.log(
        `Retrieved ${uploadRecords?.length || 0} upload records for session: ${sessionId}`,
      );

      return (uploadRecords || []).map((record: any) => ({
        id: record.id,
        code: record.code,
        sessionId: record.session_id,
        imageUrl: record.image_url,
        originalImageUrl: record.original_image_url,
        shapedImageUrl: record.shaped_image_url,
        productId: record.product_id,
        productName: record.product_name,
        productImageUrl: record.product_image_url,
        metadata: record.metadata,
        createdAt: record.created_at,
        expiresAt: record.expires_at,
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to retrieve upload records';
      this.logger.error(`Error retrieving upload records:`, error);
      throw new BadRequestException(errorMessage);
    }
  }

  /**
   * Delete an upload record
   */
  async deleteUpload(code: string): Promise<void> {
    if (!this.supabase) {
      throw new BadRequestException('Supabase service is not configured.');
    }

    try {
      const { error: deleteError } = await this.supabase
        .from('uploads')
        .delete()
        .eq('code', code.toUpperCase());

      if (deleteError) {
        throw new BadRequestException(
          `Failed to delete upload record: ${deleteError.message}`,
        );
      }

      this.logger.log(`Deleted upload record for code: ${code}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to delete upload record';
      this.logger.error(`Error deleting upload record:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(errorMessage);
    }
  }
}
