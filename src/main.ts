import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Load environment variables early
  if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
  }

  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;

  // Enable CORS for frontend origins
  const allowedOrigins = [
    'https://loretana.com',
    'https://www.loretana.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  app.enableCors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
