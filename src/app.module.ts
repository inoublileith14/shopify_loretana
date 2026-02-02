import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QrModule } from './qr/qr.module';
import { EmailModule } from './email/email.module';
import { CustomizerModule } from './customizer/customizer.module';
import { ShopifyModule } from './shopify/shopify.module';
import { ProductUploadsModule } from './product-uploads/product-uploads.module';
import { GenerateModule } from './generate/generate.module';

@Module({
  imports: [
    QrModule,
    EmailModule,
    CustomizerModule,
    GenerateModule,
    ShopifyModule,
    ProductUploadsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
