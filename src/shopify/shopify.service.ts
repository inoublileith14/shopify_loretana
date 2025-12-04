import { Injectable, Logger, BadRequestException } from '@nestjs/common';

interface ShopifyOrder {
  id: string;
  order_number: number;
  created_at: string;
  updated_at: string;
  customer: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  };
  line_items: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
}

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);
  private readonly defaultShopDomain =
    process.env.SHOPIFY_STORE_DOMAIN || 'loretana.com';
  private readonly defaultAccessToken = process.env.SHOPIFY_ACCESS_TOKEN || '';

  /**
   * Fetch orders from Shopify store
   * @param limit - Number of orders to fetch (default: 50, max: 250)
   * @param status - Filter by order status (default: any)
   * @param shopDomain - Optional: Override default Shopify store domain
   * @param accessToken - Optional: Override default access token
   */
  async getOrders(
    limit: number = 50,
    status: string = 'any',
    shopDomain?: string,
    accessToken?: string,
  ): Promise<{
    success: boolean;
    orders: ShopifyOrder[];
    total: number;
    message: string;
  }> {
    try {
      const domain = shopDomain || this.defaultShopDomain;
      const token = accessToken || this.defaultAccessToken;

      if (!domain || !token) {
        throw new BadRequestException(
          'Shopify credentials not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN environment variables.',
        );
      }

      // Validate limit
      const validLimit = Math.min(Math.max(limit, 1), 250);

      // Build the API URL
      const apiUrl = `https://${domain}/admin/api/2024-01/orders.json?limit=${validLimit}&status=${status}`;

      this.logger.log(`Fetching orders from Shopify store: ${domain}`);

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Shopify API error (${response.status}): ${errorBody}`,
        );
        throw new BadRequestException(
          `Failed to fetch orders from Shopify: ${response.statusText}`,
        );
      }

      const data: ShopifyOrdersResponse = await response.json();

      this.logger.log(
        `Successfully fetched ${data.orders.length} orders from Shopify store: ${domain}`,
      );

      return {
        success: true,
        orders: data.orders,
        total: data.orders.length,
        message: `Successfully fetched ${data.orders.length} orders`,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Shopify orders:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch Shopify orders');
    }
  }

  /**
   * Fetch a single order by ID
   * @param orderId - Shopify order ID
   * @param shopDomain - Optional: Override default store domain
   * @param accessToken - Optional: Override default access token
   */
  async getOrderById(
    orderId: string,
    shopDomain?: string,
    accessToken?: string,
  ): Promise<{ success: boolean; order: ShopifyOrder; message: string }> {
    try {
      const domain = shopDomain || this.defaultShopDomain;
      const token = accessToken || this.defaultAccessToken;

      if (!domain || !token || !orderId) {
        throw new BadRequestException(
          'Shopify credentials and order ID are required.',
        );
      }

      const apiUrl = `https://${domain}/admin/api/2024-01/orders/${orderId}.json`;

      this.logger.log(
        `Fetching order ${orderId} from Shopify store: ${domain}`,
      );

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Shopify API error (${response.status}): ${errorBody}`,
        );
        throw new BadRequestException(
          `Failed to fetch order from Shopify: ${response.statusText}`,
        );
      }

      const data = await response.json();

      this.logger.log(`Successfully fetched order ${orderId} from Shopify`);

      return {
        success: true,
        order: data.order,
        message: `Successfully fetched order ${orderId}`,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch Shopify order ${orderId}:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch Shopify order');
    }
  }

  /**
   * Get order count for a store
   * @param status - Filter by order status (default: 'any')
   * @param shopDomain - Optional: Override default store domain
   * @param accessToken - Optional: Override default access token
   */
  async getOrderCount(
    status: string = 'any',
    shopDomain?: string,
    accessToken?: string,
  ): Promise<{ success: boolean; count: number; message: string }> {
    try {
      const domain = shopDomain || this.defaultShopDomain;
      const token = accessToken || this.defaultAccessToken;

      if (!domain || !token) {
        throw new BadRequestException(
          'Shopify credentials not configured. Set SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN environment variables.',
        );
      }

      const apiUrl = `https://${domain}/admin/api/2024-01/orders/count.json?status=${status}`;

      this.logger.log(`Fetching order count from Shopify store: ${domain}`);

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Shopify API error (${response.status}): ${errorBody}`,
        );
        throw new BadRequestException(
          `Failed to fetch order count from Shopify: ${response.statusText}`,
        );
      }

      const data = await response.json();

      this.logger.log(`Order count from Shopify: ${data.count}`);

      return {
        success: true,
        count: data.count,
        message: `Total orders: ${data.count}`,
      };
    } catch (error) {
      this.logger.error('Failed to fetch Shopify order count:', error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch Shopify order count');
    }
  }
}
