import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { promises as dns } from 'dns';

@Injectable()
export class SessionUploadService {
  private readonly logger = new Logger(SessionUploadService.name);
  private supabase: any;

  constructor() {
    this.initializeSupabase();
  }

  private async initializeSupabase(): Promise<void> {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        this.logger.warn('Supabase credentials not configured; session upload disabled.');
        this.supabase = null;
        return;
      }

      // Quick DNS lookup to detect obvious misconfiguration (ENOTFOUND) early
      try {
        const host = new URL(supabaseUrl).hostname;
        await dns.lookup(host);
      } catch (err) {
        this.logger.error('Supabase host lookup failed; storage operations will be disabled. Check SUPABASE_URL:', err?.message || err);
        this.supabase = null;
        return;
      }

      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.logger.log('SessionUploadService: Supabase client created');

      // Optionally verify storage is accessible (warn only)
      try {
        // List root customizer folder to confirm storage connectivity
        await this.supabase.storage.from('customizer-uploads').list('customizer');
        this.logger.log('SessionUploadService: Supabase storage accessible');
      } catch (err) {
        this.logger.warn('SessionUploadService: Supabase storage appears unreachable or misconfigured:', err?.message || err);
        // keep client but leave note in logs; actual upload calls will fail with clear errors
      }
    } catch (err) {
      this.logger.error('Failed to initialize Supabase in SessionUploadService:', err);
      this.supabase = null;
    }
  }

  /**
   * Store provided files under folder customizer/<sessionId>/
   * Expects files.original[0], files.shape[0], files.qr[0]
   */
  async storeSessionFiles(
    sessionId: string,
    files: {
      original?: Express.Multer.File[];
      shape?: Express.Multer.File[];
      qr?: Express.Multer.File[];
    },
  ): Promise<{ success: boolean; originalUrl?: string; shapeUrl?: string; qrUrl?: string }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('sessionId is required');
    }

    if (!this.supabase) {
      throw new BadRequestException('Supabase is not configured');
    }

    const originalFile = files.original && files.original[0] ? files.original[0] : null;
    const shapeFile = files.shape && files.shape[0] ? files.shape[0] : null;
    const qrFile = files.qr && files.qr[0] ? files.qr[0] : null;

    if (!originalFile || !shapeFile || !qrFile) {
      throw new BadRequestException('original, shape and qr files are required');
    }

    try {
      const folder = `customizer/${sessionId}`;
      const origPath = `${folder}/original.png`;
      const shapePath = `${folder}/shape.png`;
      const qrPath = `${folder}/qr.png`;

      const upsertOpts = { contentType: originalFile.mimetype || 'image/png', cacheControl: '3600', upsert: true };

      // Upload original
      let { error: origErr } = await this.supabase.storage.from('customizer-uploads').upload(origPath, originalFile.buffer, upsertOpts);
      if (origErr) {
        this.logger.error('Failed to upload original:', origErr);
        throw new BadRequestException('Failed to upload original');
      }

      // Upload shape
      let { error: shapeErr } = await this.supabase.storage.from('customizer-uploads').upload(shapePath, shapeFile.buffer, { contentType: shapeFile.mimetype || 'image/png', cacheControl: '3600', upsert: true });
      if (shapeErr) {
        this.logger.error('Failed to upload shape:', shapeErr);
        throw new BadRequestException('Failed to upload shape');
      }

      // Upload qr
      let { error: qrErr } = await this.supabase.storage.from('customizer-uploads').upload(qrPath, qrFile.buffer, { contentType: qrFile.mimetype || 'image/png', cacheControl: '3600', upsert: true });
      if (qrErr) {
        this.logger.error('Failed to upload qr:', qrErr);
        throw new BadRequestException('Failed to upload qr');
      }

      const { data: origUrlData } = this.supabase.storage.from('customizer-uploads').getPublicUrl(origPath);
      const { data: shapeUrlData } = this.supabase.storage.from('customizer-uploads').getPublicUrl(shapePath);
      const { data: qrUrlData } = this.supabase.storage.from('customizer-uploads').getPublicUrl(qrPath);

      const cacheBuster = `v=${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
      const originalUrl = origUrlData?.publicUrl ? `${origUrlData.publicUrl}${origUrlData.publicUrl.includes('?') ? '&' : '?'}${cacheBuster}` : undefined;
      const shapeUrl = shapeUrlData?.publicUrl ? `${shapeUrlData.publicUrl}${shapeUrlData.publicUrl.includes('?') ? '&' : '?'}${cacheBuster}` : undefined;
      const qrUrl = qrUrlData?.publicUrl ? `${qrUrlData.publicUrl}${qrUrlData.publicUrl.includes('?') ? '&' : '?'}${cacheBuster}` : undefined;

      this.logger.log(`Stored session files for ${sessionId}`);

      return { success: true, originalUrl, shapeUrl, qrUrl };
    } catch (error) {
      this.logger.error('storeSessionFiles failed:', error);
      throw new BadRequestException('Failed to store session files');
    }
  }

  /**
   * Find the QR file for a given sessionId (searches folders named `sessionId` or `sessionId-<productId>`)
   * Returns a public URL with a cache-busting query string.
   */
  async getQrPublicUrl(sessionId: string): Promise<{ publicUrl: string }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('sessionId is required');
    }

    if (!this.supabase) {
      throw new BadRequestException('Supabase is not configured');
    }

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        this.logger.error('Failed to list customizer root:', listRootError);
        throw new BadRequestException('Failed to list customizer folders');
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

        if (listFilesError || !files) continue;

        // Common QR filenames
        const qrCandidates = ['qr.png', 'qr_code.png', 'qrcode.png'];

        for (const f of files) {
          if (!f || !f.name) continue;
          const nameLower = f.name.toLowerCase();
          if (qrCandidates.includes(nameLower) || nameLower.startsWith('qr')) {
            const filePath = `${folderPath}/${f.name}`;
            const { data: urlData } = this.supabase.storage
              .from('customizer-uploads')
              .getPublicUrl(filePath);

            const baseUrl = urlData?.publicUrl || '';
            if (!baseUrl) continue;
            const cacheBuster = `v=${Date.now()}_${Math.random().toString(36).substring(2,8)}`;
            const publicUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${cacheBuster}`;
            return { publicUrl };
          }
        }
      }

      throw new NotFoundException('QR not found for this session');
    } catch (error) {
      this.logger.error(`Failed to fetch QR for session ${sessionId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to fetch QR');
    }
  }

  /**
   * Download the QR file bytes for a session and return buffer + mime + filename
   */
  async getQrFile(sessionId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('sessionId is required');
    }

    if (!this.supabase) {
      throw new BadRequestException('Supabase is not configured');
    }

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        this.logger.error('Failed to list customizer root:', listRootError);
        throw new BadRequestException('Failed to list customizer folders');
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

        if (listFilesError || !files) continue;

        const qrCandidates = ['original.png', 'original_code.png', 'originalcode.png'];

        for (const f of files) {
          if (!f || !f.name) continue;
          const nameLower = f.name.toLowerCase();
          if (qrCandidates.includes(nameLower) || nameLower.startsWith('qr')) {
            const filePath = `${folderPath}/${f.name}`;

            const { data: downloadData, error: downloadErr } = await this.supabase.storage
              .from('customizer-uploads')
              .download(filePath);

            if (downloadErr || !downloadData) {
              this.logger.warn(`Failed to download ${filePath}: ${downloadErr?.message || String(downloadErr)}`);
              continue;
            }

            // Convert downloadData to Buffer
            let buffer: Buffer;
            // In Node environments downloadData may be a ReadableStream or have arrayBuffer()
            if (typeof (downloadData as any).arrayBuffer === 'function') {
              const ab = await (downloadData as any).arrayBuffer();
              buffer = Buffer.from(ab);
            } else if ((downloadData as any).pipe) {
              // readable stream
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                (downloadData as any)
                  .on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
                  .on('end', () => resolve())
                  .on('error', (e: any) => reject(e));
              });
              buffer = Buffer.concat(chunks);
            } else if (downloadData instanceof Uint8Array) {
              buffer = Buffer.from(downloadData as Uint8Array);
            } else {
              // Fallback: try to coerce
              buffer = Buffer.from(await (downloadData as any).toString());
            }

            // Try to infer MIME from filename
            const mimeType = nameLower.endsWith('.png') ? 'image/png' : nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';

            return { buffer, mimeType, name: f.name };
          }
        }
      }

      throw new NotFoundException('QR not found for this session');
    } catch (error) {
      this.logger.error(`Failed to download QR for session ${sessionId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to download QR');
    }
  }

  /**
   * Download the original file (original.png, jpg, etc.) for a session and return buffer + mime + filename
   */
  async getOriginalFile(sessionId: string): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    if (!sessionId || sessionId.trim() === '') {
      throw new BadRequestException('sessionId is required');
    }

    if (!this.supabase) {
      throw new BadRequestException('Supabase is not configured');
    }

    try {
      const { data: entries, error: listRootError } = await this.supabase.storage
        .from('customizer-uploads')
        .list('customizer');

      if (listRootError) {
        this.logger.error('Failed to list customizer root:', listRootError);
        throw new BadRequestException('Failed to list customizer folders');
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

        if (listFilesError || !files) continue;

        // Common original filenames
        const origCandidates = ['original.png', 'original.jpg', 'original.jpeg', 'original.webp', 'original.bmp', 'original.tiff'];

        for (const f of files) {
          if (!f || !f.name) continue;
          const nameLower = f.name.toLowerCase();
          if (origCandidates.includes(nameLower) || nameLower.startsWith('original')) {
            const filePath = `${folderPath}/${f.name}`;

            const { data: downloadData, error: downloadErr } = await this.supabase.storage
              .from('customizer-uploads')
              .download(filePath);

            if (downloadErr || !downloadData) {
              this.logger.warn(`Failed to download ${filePath}: ${downloadErr?.message || String(downloadErr)}`);
              continue;
            }

            // Convert downloadData to Buffer (same approach as getQrFile)
            let buffer: Buffer;
            if (typeof (downloadData as any).arrayBuffer === 'function') {
              const ab = await (downloadData as any).arrayBuffer();
              buffer = Buffer.from(ab);
            } else if ((downloadData as any).pipe) {
              const chunks: Buffer[] = [];
              await new Promise<void>((resolve, reject) => {
                (downloadData as any)
                  .on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
                  .on('end', () => resolve())
                  .on('error', (e: any) => reject(e));
              });
              buffer = Buffer.concat(chunks);
            } else if (downloadData instanceof Uint8Array) {
              buffer = Buffer.from(downloadData as Uint8Array);
            } else {
              buffer = Buffer.from(await (downloadData as any).toString());
            }

            const mimeType = nameLower.endsWith('.png') ? 'image/png' : nameLower.endsWith('.jpg') || nameLower.endsWith('.jpeg') ? 'image/jpeg' : nameLower.endsWith('.webp') ? 'image/webp' : 'application/octet-stream';

            return { buffer, mimeType, name: f.name };
          }
        }
      }

      throw new NotFoundException('Original file not found for this session');
    } catch (error) {
      this.logger.error(`Failed to download original for session ${sessionId}:`, error);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to download original');
    }
  }
}
