import { NestFactory } from '@nestjs/core';
import { VercelRequest, VercelResponse } from '@vercel/node';

let app: any;

export default async (req: VercelRequest, res: VercelResponse) => {
  if (!app) {
    try {
      // Import AppModule from the dist folder at runtime (use compiled JS)
      const path = require('path');
      const modulePath = path.join(process.cwd(), 'dist', 'src', 'app.module.js');
      const { AppModule } = await import(modulePath);
      app = await NestFactory.create(AppModule);
      await app.init();
    } catch (error) {
      console.error('Failed to initialize NestJS app:', error);
      res.status(500).json({ error: 'Failed to initialize app', message: String(error) });
      return;
    }
  }

  try {
    const server = app.getHttpServer();
    return server(req, res);
  } catch (error) {
    console.error('Request handling error:', error);
    res.status(500).json({ error: 'Request failed', message: String(error) });
  }
};
