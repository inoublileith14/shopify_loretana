import { NestFactory } from '@nestjs/core';
import { VercelRequest, VercelResponse } from '@vercel/node';

let app: any;

export default async (req: VercelRequest, res: VercelResponse) => {
  if (!app) {
    try {
        let moduleImport: any = null;

        // Try compiled output first (when `npm run build` was executed)
        try {
          // ESM build output uses .js extension
          // @ts-ignore - runtime-only dynamic import; `dist` won't exist during type-check
          moduleImport = await import('../dist/src/app.module.js');
        } catch (e1) {
          // Fall back to importing the TS source so Vercel's bundler can include it
          try {
            // @ts-ignore - runtime-only dynamic import of source for Vercel bundling
            moduleImport = await import('../src/app.module');
          } catch (e2) {
            console.error('Both dist and src imports failed', { e1, e2 });
            throw e2 || e1;
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
