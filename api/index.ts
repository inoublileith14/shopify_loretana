import { NestFactory } from '@nestjs/core';
import { VercelRequest, VercelResponse } from '@vercel/node';

let app: any;

// CORS allowed origins
const ALLOWED_ORIGINS = [
  'https://loretana.com',
  'https://www.loretana.com',
  'http://localhost:3000',
  'https://loretana-backend.vercel.app/',
];

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin as string | undefined;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Allow requests with no origin (server-to-server)
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // Handle CORS preflight
  if (setCorsHeaders(req, res)) {
    return;
  }

  if (!app) {
    try {
        let moduleImport: any = null;

        // Import from the compiled dist output
        try {
          // @ts-ignore - runtime-only dynamic import
          moduleImport = await import('./dist/app.module.js');
        } catch (err) {
          console.error('Failed to import AppModule from ./dist:', err);
          try {
            // Fallback: try from ../dist
            moduleImport = await import('../dist/app.module.js');
          } catch (fallbackErr) {
            console.error('Failed to import AppModule from ../dist:', fallbackErr);
            throw new Error(
              'Cannot find compiled AppModule. Ensure "npm run build" was executed before deployment. ' +
              'Error: ' + (err instanceof Error ? err.message : String(err))
            );
          }
        }

        const { AppModule } = moduleImport;
      app = await NestFactory.create(AppModule);
      await app.init();
    } catch (error) {
      console.error('Failed to initialize NestJS app:', error);
      res.status(500).json({ error: 'Failed to initialize app', message: String(error) });
      return;
    }
  }

  try {
      // Prefer the underlying framework instance (Express) if available
      const httpAdapter = app.getHttpAdapter && app.getHttpAdapter();
      const server = httpAdapter?.getInstance ? httpAdapter.getInstance() : app.getHttpServer();

      if (typeof server === 'function') {
        // Express handler
        return server(req, res);
      }

      // If we don't have an express-like function, try emitting a request
      const httpServer = app.getHttpServer && app.getHttpServer();
      if (httpServer && typeof httpServer.emit === 'function') {
        httpServer.emit('request', req, res);
        return;
      }

      throw new Error('Unable to handle request: incompatible server instance');
  } catch (error) {
    console.error('Request handling error:', error);
    res.status(500).json({ error: 'Request failed', message: String(error) });
  }
};
