import { NestFactory } from '@nestjs/core';
import { VercelRequest, VercelResponse } from '@vercel/node';

let app: any;

export default async (req: VercelRequest, res: VercelResponse) => {
  if (!app) {
    try {
      // Import AppModule from the dist folder at runtime
      const { AppModule } = await import('../dist/src/app.module');
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
