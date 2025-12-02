import { NestFactory } from '@nestjs/core';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { AppModule } from '../src/app.module';

let app: any;

export default async (req: VercelRequest, res: VercelResponse) => {
  if (!app) {
    app = await NestFactory.create(AppModule);
    await app.init();
  }

  // Forward all requests to the NestJS app
  const server = app.getHttpServer();
  return server(req, res);
};
