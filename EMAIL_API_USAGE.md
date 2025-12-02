# Email API — How to use `/email/send`

This document shows how the frontend should call the email endpoint.

Base URL

- Production endpoint: `https://loretana-backend.vercel.app/email/send`

Overview

- Method: POST
- Successful response: HTTP 200 with JSON { success: true, message: 'Email sent successfully', messageId }
- Error response: HTTP 500 (or other codes) with an error message.

Request body options

1) Simple JSON (no attachments)
- Content-Type: `application/json`
- Body: Send a JSON payload matching `SendEmailDto`:

Example curl (JSON):

```bash
curl -X POST 'https://loretana-backend.vercel.app/email/send' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "recipient@example.com",
    "senderEmail": "you@yourdomain.com",
    "subject": "Hello from the frontend",
    "text": "Plain text fallback",
    "html": "<p>This is an <strong>HTML</strong> message</p>"
  }'
```

2) FormData (with attachments)
- Use `multipart/form-data` when uploading files from the browser.
- Use field name `attachments` for files (API supports multiple files).
- Other fields are sent as regular form fields.

Example JavaScript (browser / fetch):

```javascript
async function sendEmailWithAttachments() {
  const url = 'https://loretana-backend.vercel.app/email/send';
  const form = new FormData();

  // text fields
  form.append('to', 'recipient@example.com');
  form.append('subject', 'Files attached');
  form.append('text', 'See attached files');
  form.append('html', '<p>See attached files</p>');

  // attachments: <input type="file" multiple id="files" />
  const input = document.getElementById('files');
  if (input && input.files) {
    for (let i = 0; i < input.files.length; i++) {
      // field name must be `attachments`
      form.append('attachments', input.files[i]);
    }
  }

  const resp = await fetch(url, {
    method: 'POST',
    body: form,
  });

  const data = await resp.json();
  console.log(data);
}
```

Example curl (FormData with files):

```bash
curl -X POST 'https://loretana-backend.vercel.app/email/send' \
  -F 'to=recipient@example.com' \
  -F 'subject=Hello with file' \
  -F 'text=Please see the attached file' \
  -F "attachments=@/path/to/file1.pdf" \
  -F "attachments=@/path/to/file2.png"
```

Notes and tips

- Required fields: `subject` is required by the DTO; `to` is recommended (defaults to `inoublileith6@gmail.com` if not provided).
- Attachments: the API enforces per-file and total size limits. If you hit errors, reduce file sizes or send fewer files.
- Errors: If you receive an error `Missing credentials for "PLAIN"`, the backend is using SMTP without a configured password. Ask the backend team to set `SENDGRID_API_KEY` (preferred) or `EMAIL_PASSWORD` in environment variables.
- CORS: The backend is hosted as a serverless function — if you call it from the browser, ensure CORS is allowed (the backend should already be handling requests; if you see CORS errors, let the backend team know).

Debugging

- If requests fail, capture these details for the backend team:
  - Request payload and headers
  - Response body and status code
  - Timestamp and any console/network logs from the browser

Contact

- For further help, contact the backend developer and include the above debug details.
