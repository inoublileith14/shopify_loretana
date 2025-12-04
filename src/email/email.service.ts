import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nodemailer = require('nodemailer');
// Use SendGrid as an optional fallback for environments where SMTP creds are not provided

const sgMail = require('@sendgrid/mail');
// Use MailComposer to build a raw message with explicit nested MIME parts
// This helps ensure multipart/alternative (text+html) is nested inside
// multipart/mixed when attachments are present so clients render HTML first.

const MailComposer = require('nodemailer/lib/mail-composer');

interface AttachmentConfig {
  filename: string;
  path?: string;
  content?: Buffer | string;
  contentType?: string;
}

interface MailResponse {
  messageId: string;
  response?: string;
}

@Injectable()
export class EmailService {
  private transporter: any;
  private logger = new Logger(EmailService.name);
  private readonly senderEmail: string;
  private useSendGrid = false;

  constructor() {
    this.senderEmail = process.env.EMAIL_USER || 'inoublileith6@gmail.com';

    // If a SendGrid API key is provided, prefer SendGrid (no SMTP credentials required)
    if (process.env.SENDGRID_API_KEY) {
      try {
        sgMail.setApiKey(process.env.SENDGRID_API_KEY);
        this.useSendGrid = true;
        this.logger.log(
          'Using SendGrid for sending emails (SENDGRID_API_KEY detected)',
        );
      } catch (err) {
        this.logger.warn(
          'Failed to initialize SendGrid client, will attempt SMTP if configured',
          err,
        );
        this.useSendGrid = false;
      }
    }

    // Initialize transporter with Gmail SMTP if not using SendGrid
    if (!this.useSendGrid) {
      const smtpPass = process.env.EMAIL_PASSWORD || '';
      if (!smtpPass) {
        this.logger.warn(
          'EMAIL_PASSWORD is not set. SMTP (Gmail) auth will likely fail. Consider setting EMAIL_PASSWORD (app password) or providing SENDGRID_API_KEY for SendGrid.',
        );
      }

      // For Gmail, use App Passwords if 2FA is enabled
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: this.senderEmail,
          pass: smtpPass,
        },
      });
    }

    // Verify connection asynchronously (don't block startup)
    this.verifyConnectionAsync();
  }

  private verifyConnectionAsync(): void {
    // Run verification in the background without blocking
    this.verifyConnection().catch((error) => {
      this.logger.warn(
        'Email verification failed - service will attempt to send emails anyway',
        error,
      );
    });
  }

  private buildEmailTemplate(
    recipientEmail: string,
    bodyText: string,
    customSenderEmail?: string,
  ): string {
    const sender = customSenderEmail || this.senderEmail;
    const timestamp = new Date().toLocaleString();
    const year = new Date().getFullYear();
    // Use a public URL or convert to base64
    const logoUrl =
      'https://raw.githubusercontent.com/yourusername/your-repo/main/logo.png';

    return `<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <!-- Main Container -->
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    
    <!-- Header with Logo and Green Background -->
    <div style="background: linear-gradient(135deg, #006039 0%, #004d2e 100%); padding: 30px 20px; text-align: center;">
      <div style="margin-bottom: 15px;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: 0.5px;">Loretana</h1>
      </div>
      <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; letter-spacing: 0.3px;">Backend API</p>
    </div>

    <!-- Content Section -->
    <div style="padding: 40px 30px; background-color: #ffffff;">
      
      <!-- Greeting -->
      <div style="margin-bottom: 30px;">
        <p style="margin: 0; color: #333333; font-size: 16px; line-height: 1.6;">Hello,</p>
        <p style="margin: 15px 0 0 0; color: #555555; font-size: 15px; line-height: 1.8;">You have received a new email from the Loretana Backend API. Here are the details:</p>
      </div>

      <!-- Info Cards -->
      <div style="margin-bottom: 30px;">
        <!-- From Card -->
        <div style="background-color: #f9f9f9; border-left: 4px solid #006039; padding: 15px 18px; margin-bottom: 12px; border-radius: 3px;">
          <p style="margin: 0; color: #006039; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">From (Sender)</p>
          <p style="margin: 8px 0 0 0; color: #333333; font-size: 16px; font-weight: 500;">${sender}</p>
        </div>

        <!-- To Card -->
        <div style="background-color: #f9f9f9; border-left: 4px solid #006039; padding: 15px 18px; margin-bottom: 12px; border-radius: 3px;">
          <p style="margin: 0; color: #006039; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">To (Recipient)</p>
          <p style="margin: 8px 0 0 0; color: #333333; font-size: 16px; font-weight: 500;">${recipientEmail}</p>
        </div>

        <!-- Time Card -->
        <div style="background-color: #f9f9f9; border-left: 4px solid #006039; padding: 15px 18px; border-radius: 3px;">
          <p style="margin: 0; color: #006039; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">Sent At</p>
          <p style="margin: 8px 0 0 0; color: #333333; font-size: 16px; font-weight: 500;">${timestamp}</p>
        </div>
      </div>

      <!-- Message Section -->
      <div style="margin-top: 40px; padding-top: 30px; border-top: 2px solid #f0f0f0;">
        <h2 style="margin: 0 0 20px 0; color: #006039; font-size: 18px; font-weight: 600; letter-spacing: 0.3px;">Message Content</h2>
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; border: 1px solid #e8e8e8;">
          <p style="margin: 0; color: #333333; font-size: 15px; line-height: 1.8; white-space: pre-wrap; word-wrap: break-word;">${bodyText.replace(/\n/g, '<br/>')}</p>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #1a1a1a; color: #ffffff; padding: 30px; text-align: center; border-top: 4px solid #006039;">
      <div style="margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">Loretana Backend API</p>
        <p style="margin: 8px 0 0 0; font-size: 12px; color: #b0b0b0;">Professional Email Service</p>
      </div>
      
      <div style="border-top: 1px solid #333333; padding-top: 15px;">
        <p style="margin: 0; font-size: 12px; color: #808080; line-height: 1.6;">
          This is an automated email from Loretana. Please do not reply directly to this email.<br/>
          If you have any questions, contact our support team.
        </p>
      </div>

      <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #333333;">
        <p style="margin: 0; font-size: 11px; color: #606060; letter-spacing: 0.3px;">&copy; ${year} Loretana. All rights reserved.</p>
      </div>
    </div>

  </div>
</body>
</html>`;
  }

  private async verifyConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log('Email service connected successfully');
    } catch (error) {
      this.logger.warn('Failed to verify email connection', error);
      // Don't throw - allow service to start even if verification fails
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
    attachments?: AttachmentConfig[],
    senderEmail?: string,
  ): Promise<MailResponse> {
    try {
      if (!to) {
        throw new Error('Recipient email address is required');
      }

      if (!subject || !text) {
        throw new Error('Subject and text are required');
      }

      // Build formatted HTML email if custom HTML not provided
      const formattedHtml =
        html || this.buildEmailTemplate(to, text, senderEmail);

      // Prepare all attachments - user attachments ONLY (logo will be inline)
      const allAttachments: any[] = [];

      // Add user-provided attachments first
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        this.logger.log(`Processing ${attachments.length} user attachment(s)`);

        for (const att of attachments) {
          const attachment: any = {
            filename: att.filename,
          };

          // Use content if available, otherwise use path
          if (att.content) {
            attachment.content = att.content;
            this.logger.log(
              `Added user attachment: ${att.filename} (${att.content instanceof Buffer ? att.content.length : 0} bytes)`,
            );
          } else if (att.path) {
            attachment.path = att.path;
            this.logger.log(
              `Added user attachment: ${att.filename} (from path)`,
            );
          }

          if (att.contentType) {
            attachment.contentType = att.contentType;
          }

          allAttachments.push(attachment);
        }
      }

      this.logger.log(
        `Sending email to ${to} with ${allAttachments.length} user attachment(s)`,
      );

      const mailOptions = {
        from: senderEmail || this.senderEmail,
        to,
        subject,
        // Plain-text fallback
        text: text,
        // html is provided, but also include it as an explicit alternative
        html: formattedHtml,
        alternatives: [
          {
            contentType: 'text/html; charset=UTF-8',
            content: formattedHtml,
          },
        ],
        attachments: allAttachments,
      } as const;

      this.logger.log(`Sending email to ${to} with HTML template`);
      this.logger.debug(
        `Attachments details: ${JSON.stringify(allAttachments.map((a) => ({ filename: a.filename, hasCid: !!a.cid, hasContent: !!a.content, hasPath: !!a.path })))}`,
      );

      // Build a MailComposer message to force a nested MIME structure.
      // When attachments are present, MailComposer will create a
      // multipart/mixed message with a multipart/alternative part
      // (text + html) as the first child, followed by attachments.
      const mailComposer = new MailComposer({
        from: senderEmail || this.senderEmail,
        to,
        subject,
        text,
        html: formattedHtml,
        // pass attachments along as-is (MailComposer accepts path/content/contentType)
        attachments: allAttachments,
      });

      // Compile to raw message buffer
      const rawMessage: Buffer = await new Promise((resolve, reject) => {
        // build returns a Buffer via callback
        mailComposer.compile().build((err: Error | null, msg: Buffer) => {
          if (err) return reject(err);
          return resolve(msg);
        });
      });

      // If SendGrid is configured, use it instead of raw SMTP
      if (this.useSendGrid) {
        const sgAttachments = allAttachments.map((a) => ({
          content: a.content
            ? Buffer.isBuffer(a.content)
              ? a.content.toString('base64')
              : Buffer.from(String(a.content)).toString('base64')
            : undefined,
          filename: a.filename,
          type: a.contentType,
          disposition: 'attachment',
        }));

        const msg: any = {
          from: senderEmail || this.senderEmail,
          to,
          subject,
          text,
          html: formattedHtml,
          attachments: sgAttachments,
        };

        this.logger.debug('Sending email via SendGrid', {
          to,
          subject,
          attachments: sgAttachments.length,
        });

        const response = await sgMail.send(msg);
        // SendGrid returns an array of responses for some versions
        const first = Array.isArray(response) ? response[0] : response;

        this.logger.log(
          `Email sent via SendGrid from ${senderEmail || this.senderEmail} to ${to}`,
        );

        return {
          messageId:
            first && first.headers ? first.headers['x-message-id'] || '' : '',
          response:
            first && first.statusCode ? String(first.statusCode) : undefined,
        };
      }

      // Send raw MIME message via SMTP transporter to ensure structure is preserved
      // Provide explicit envelope to avoid relying on header parsing
      const envelope = { from: senderEmail || this.senderEmail, to };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const info: any = await this.transporter.sendMail({
        envelope,
        raw: rawMessage,
      });

      // Log transport response for debugging (accepted/rejected/envelope)
      this.logger.debug(
        `SMTP info: ${JSON.stringify({ messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response })}`,
      );

      this.logger.log(
        `Email sent successfully from ${senderEmail || this.senderEmail} to ${to} with ${allAttachments.length} total attachment(s)`,
      );

      return {
        // messageId may be present depending on transport
        messageId: info && info.messageId ? (info.messageId as string) : '',
        response: info && info.response ? (info.response as string) : undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      this.logger.error(`Failed to send email: ${errorMessage}`, error);
      throw error;
    }
  }
}
