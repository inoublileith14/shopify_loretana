import { Module } from '@nestjs/common';
import { CustomizerController } from './customizer.controller';
import { CustomizerService } from './customizer.service';
import { ShopifyModule } from '../shopify/shopify.module';
import { ProductUploadsModule } from '../product-uploads/product-uploads.module';
import { SessionUploadModule } from './session-upload.module';

@Module({
  imports: [ShopifyModule, ProductUploadsModule, SessionUploadModule],
  controllers: [CustomizerController],
  providers: [CustomizerService],
  exports: [CustomizerService],
})
export class CustomizerModule {}
