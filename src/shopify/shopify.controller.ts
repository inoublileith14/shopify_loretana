import { Controller, Get, Query, Logger, HttpStatus } from '@nestjs/common';
import { ShopifyService } from './shopify.service';

@Controller('shopify')
export class ShopifyController {
  private readonly logger = new Logger(ShopifyController.name);

  constructor(private readonly shopifyService: ShopifyService) {}

  /**
   * Get orders from Shopify store
   * GET /shopify/orders?limit=50&status=any
   *
   * Uses credentials from environment variables (SHOPIFY_STORE_DOMAIN, SHOPIFY_ACCESS_TOKEN)
   *
   * Query Parameters (all optional):
   * - limit: Number of orders to fetch (default: 50, max: 250)
   * - status: Filter by status (default: any)
   * - shopDomain: Override the default store domain
   * - accessToken: Override the default access token
   */
  @Get('orders')
  async getOrders(
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('shopDomain') shopDomain?: string,
    @Query('accessToken') accessToken?: string,
  ): Promise<any> {
    try {
      this.logger.log('Orders request received');

      const orderLimit = limit ? parseInt(limit, 10) : 50;
      const orderStatus = status || 'any';

      const result = await this.shopifyService.getOrders(
        orderLimit,
        orderStatus,
        shopDomain,
        accessToken,
      );

      return {
        statusCode: HttpStatus.OK,
        ...result,
      };
    } catch (error) {
      this.logger.error('Failed to fetch orders:', error);
      throw error;
    }
  }

  /**
   * Get a specific order by ID
   * GET /shopify/orders/123456
   *
   * Uses credentials from environment variables by default
   *
   * Query Parameters (optional):
   * - shopDomain: Override the default store domain
   * - accessToken: Override the default access token
   */
  @Get('orders/:orderId')
  async getOrderById(
    @Query('orderId') orderId?: string,
    @Query('shopDomain') shopDomain?: string,
    @Query('accessToken') accessToken?: string,
  ): Promise<any> {
    try {
      if (!orderId) {
        throw new Error('Order ID is required');
      }

      this.logger.log(`Order details request for ID: ${orderId}`);

      const result = await this.shopifyService.getOrderById(
        orderId,
        shopDomain,
        accessToken,
      );

      return {
        statusCode: HttpStatus.OK,
        ...result,
      };
    } catch (error) {
      this.logger.error('Failed to fetch order:', error);
      throw error;
    }
  }

  /**
   * Get order count for the store
   * GET /shopify/count?status=any
   *
   * Uses credentials from environment variables by default
   *
   * Query Parameters (optional):
   * - status: Filter by status (default: any)
   * - shopDomain: Override the default store domain
   * - accessToken: Override the default access token
   */
  @Get('count')
  async getOrderCount(
    @Query('status') status?: string,
    @Query('shopDomain') shopDomain?: string,
    @Query('accessToken') accessToken?: string,
  ): Promise<any> {
    try {
      this.logger.log('Order count request received');

      const orderStatus = status || 'any';
      const result = await this.shopifyService.getOrderCount(
        orderStatus,
        shopDomain,
        accessToken,
      );

      return {
        statusCode: HttpStatus.OK,
        ...result,
      };
    } catch (error) {
      this.logger.error('Failed to fetch order count:', error);
      throw error;
    }
  }
}
