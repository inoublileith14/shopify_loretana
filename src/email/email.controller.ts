import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { EmailService } from './email.service';
import { SendEmailDto } from './send-email.dto';
import { promises as fsPromises } from 'fs';

@Controller('email')
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private readonly emailService: EmailService) {}

  // Limits (bytes) - configurable via env vars
  // Default per-file: 10 MB, default total: 20 MB
  private static readonly PER_FILE_LIMIT: number =
    parseInt(process.env.ATTACHMENT_MAX_FILE_SIZE || '', 10) ||
    10 * 1024 * 1024;
  private static readonly TOTAL_ATTACHMENTS_LIMIT: number =
    parseInt(process.env.ATTACHMENTS_TOTAL_MAX || '', 10) || 20 * 1024 * 1024;

  @Post('test-upload')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: EmailController.PER_FILE_LIMIT },
    }),
  )
  async testUpload(@UploadedFiles() files: Express.Multer.File[] = []) {
    this.logger.log(`Test endpoint received ${files.length} file(s)`);

    return {
      filesReceived: files.length,
      files: files.map((f) => ({
        originalname: f.originalname,
        size: f.size,
        mimetype: f.mimetype,
      })),
    };
  }

  @Post('send-test-html')
  async sendTestHtml() {
    this.logger.log('Sending test HTML-only email (no attachments)');
    const to = 'contact@loretana.com';
    const subject = 'Test HTML Only Email';
    const html = `
      <html>
        <body>
          <h1 style="color:#006039">Loretana - HTML Test</h1>
          <p>This is a <strong>test</strong> HTML email sent by the API to verify rendering.</p>
        </body>
      </html>`;

    const result = await this.emailService.sendEmail(
      to,
      subject,
      'Fallback text',
      html,
      [],
      undefined,
    );
    return { success: true, messageId: result.messageId };
  }

  @Post('send')
  @UseInterceptors(
    FilesInterceptor('attachments', 10, {
      limits: { fileSize: EmailController.PER_FILE_LIMIT },
    }),
  )
  async sendEmail(
    @Body() sendEmailDto: SendEmailDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    try {
      this.logger.log(`Received ${files.length} file(s) for email`);

      // Log detailed file info
      if (files && files.length > 0) {
        files.forEach((file, index) => {
          this.logger.log(
            `File ${index + 1}: ${file.originalname} - Size: ${file.size} bytes - Type: ${file.mimetype}`,
          );
        });
      }

      // Map uploaded files to attachment format
      const attachments: Array<{
        filename: string;
        content?: Buffer;
        contentType?: string;
        path?: string;
      }> = files.map((file: Express.Multer.File) => {
        this.logger.debug(
          `Processing file: ${file.originalname} (${file.size} bytes, ${file.mimetype})`,
        );
        return {
          filename: file.originalname,
          content: file.buffer,
          contentType: file.mimetype,
        };
      });

      // Helper to format bytes to human-readable string
      const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };

      // After mapping uploaded files, check per-file (defensive) and later total size
      for (const file of files) {
        if (file.size > EmailController.PER_FILE_LIMIT) {
          throw new HttpException(
            `Attachment "${file.originalname}" is too large (${formatBytes(file.size)}). Maximum allowed per file is ${formatBytes(EmailController.PER_FILE_LIMIT)}.`,
            HttpStatus.PAYLOAD_TOO_LARGE,
          );
        }
      }

      this.logger.log(`Total attachments to send: ${attachments.length}`);

      // If attachments are provided in DTO (file paths or base64), normalize and include them too
      if (sendEmailDto.attachments && Array.isArray(sendEmailDto.attachments)) {
        const dtoAttachments = await Promise.all(
          sendEmailDto.attachments.map(async (att) => {
            // If content is provided (e.g., base64 string or buffer), normalize to Buffer
            if (att.content !== undefined && att.content !== null) {
              const contentBuffer =
                typeof att.content === 'string'
                  ? // assume base64 for binary content; callers should provide base64 strings for binaries
                    Buffer.from(att.content, 'base64')
                  : att.content;
              return {
                filename: att.filename,
                content: contentBuffer,
                contentType: att.contentType || 'application/octet-stream',
              };
            }

            // If a file path is provided, read the file into a buffer
            if (att.path) {
              const buffer = await fsPromises.readFile(att.path);
              return {
                filename: att.filename,
                content: buffer,
                contentType: att.contentType || 'application/octet-stream',
              };
            }

            // If neither content nor path provided, throw a clear error
            throw new HttpException(
              `Attachment "${att.filename || 'unknown'}" must include either "content" or "path"`,
              HttpStatus.BAD_REQUEST,
            );
          }),
        );

        attachments.push(...dtoAttachments);
      }

      // Compute total attachments size (bytes)
      let totalBytes = 0;
      for (const a of attachments) {
        if (a.content) {
          totalBytes += Buffer.isBuffer(a.content)
            ? a.content.length
            : Buffer.byteLength(String(a.content));
        }
      }

      this.logger.log(
        `Total attachments size: ${totalBytes} bytes (${formatBytes(totalBytes)})`,
      );

      if (totalBytes > EmailController.TOTAL_ATTACHMENTS_LIMIT) {
        throw new HttpException(
          `Total attachments size (${formatBytes(totalBytes)}) exceeds the allowed limit of ${formatBytes(EmailController.TOTAL_ATTACHMENTS_LIMIT)}. Please reduce file sizes or send fewer files.`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }

      this.logger.log(
        `Sending email with ${attachments.length} total attachment(s) to ${sendEmailDto.to}`,
      );

      const result = await this.emailService.sendEmail(
        sendEmailDto.to || 'inoublileith6@gmail.com',
        sendEmailDto.subject,
        sendEmailDto.text || '',
        sendEmailDto.html,
        attachments,
        sendEmailDto.senderEmail,
      );

      return {
        success: true,
        message: 'Email sent successfully',
        messageId: result.messageId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new HttpException(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('send-simple')
  async sendSimpleEmail(@Body() sendEmailDto: SendEmailDto) {
    try {
      const result = await this.emailService.sendEmail(
        sendEmailDto.to || 'inoublileith6@gmail.com',
        sendEmailDto.subject,
        sendEmailDto.text || '',
        sendEmailDto.html,
        sendEmailDto.attachments,
        sendEmailDto.senderEmail,
      );

      return {
        success: true,
        message: 'Email sent successfully',
        messageId: result.messageId,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to send email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
