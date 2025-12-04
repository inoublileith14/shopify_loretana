import { Module } from '@nestjs/common';
import { ProductUploadsController } from './product-uploads.controller';
import { ProductsController } from './products.controller';
import { ProductUploadsService } from './product-uploads.service';
import { QrModule } from '../qr/qr.module';
import { ShopifyModule } from '../shopify/shopify.module';

@Module({
  imports: [QrModule, ShopifyModule],
  controllers: [ProductUploadsController, ProductsController],
  providers: [ProductUploadsService],
  exports: [ProductUploadsService],
})
export class ProductUploadsModule {}
