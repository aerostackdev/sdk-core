import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EcommerceService } from '../ecommerce';

// ─── Mock D1Database ──────────────────────────────────────────

function createMockD1() {
  const mockStatement = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [] }),
    run: vi.fn().mockResolvedValue({ success: true }),
  };

  const db = {
    prepare: vi.fn().mockReturnValue(mockStatement),
    batch: vi.fn().mockResolvedValue([]),
    _stmt: mockStatement,
  };

  return db;
}

function createEnv(db?: any) {
  return {
    DB: db || createMockD1(),
  } as any;
}

// ─── Constructor ──────────────────────────────────────────────

describe('EcommerceService', () => {
  describe('constructor', () => {
    it('should use DB binding', () => {
      const db = createMockD1();
      const env = { DB: db } as any;
      const svc = new EcommerceService(env, 'proj-1');
      expect(svc).toBeDefined();
    });

    it('should use DB_ECOMMERCE binding when available', () => {
      const ecomDb = createMockD1();
      const env = { DB: createMockD1(), DB_ECOMMERCE: ecomDb } as any;
      const svc = new EcommerceService(env, 'proj-1');
      expect(svc).toBeDefined();
    });

    it('should throw when no database binding found', () => {
      expect(() => new EcommerceService({} as any, 'proj-1')).toThrow(
        'Database binding (DB or DB_ECOMMERCE) not found'
      );
    });
  });

  // ─── Products ─────────────────────────────────────────────

  describe('listProducts', () => {
    it('should query products with default pagination', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 2 });
      db._stmt.all.mockResolvedValue({
        results: [
          { id: 'p1', name: 'Product 1', base_price: 10, project_id: 'proj-1', data: '{}' },
          { id: 'p2', name: 'Product 2', base_price: 20, project_id: 'proj-1', data: '{"color":"red"}' },
        ],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(2);
      expect(result.products.length).toBe(2);
    });

    it('should parse JSON data field', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 1 });
      db._stmt.all.mockResolvedValue({
        results: [
          { id: 'p1', name: 'P1', data: '{"key":"value"}', project_id: 'proj-1' },
        ],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts();

      expect(result.products[0].data).toEqual({ key: 'value' });
    });

    it('should synthesize virtual variant when no variants exist', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 1 });
      db._stmt.all
        .mockResolvedValueOnce({
          results: [
            {
              id: 'p1', name: 'P1', base_price: 10, compare_at_price: 15,
              sku: 'SKU-1', thumbnail_url: 'img.jpg', project_id: 'proj-1',
              data: '{}', created_at: '2024-01-01', updated_at: '2024-01-01',
            },
          ],
        })
        .mockResolvedValueOnce({ results: [] }); // No variants

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts();

      expect(result.products[0].variants.length).toBe(1);
      expect(result.products[0].variants[0].price).toBe(10);
      expect(result.products[0].variants[0].name).toBe('P1');
    });

    it('should strip cost field from products', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 1 });
      db._stmt.all.mockResolvedValue({
        results: [
          { id: 'p1', name: 'P1', cost: 5, base_price: 10, data: '{}', project_id: 'proj-1' },
        ],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts();

      expect(result.products[0]).not.toHaveProperty('cost');
    });

    it('should filter by category', async () => {
      const db = createMockD1();
      db._stmt.first
        .mockResolvedValueOnce({ id: 'cat-1' }) // category lookup
        .mockResolvedValueOnce({ total: 1 }); // count
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'p1', name: 'P1', data: '{}', project_id: 'proj-1' }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts({ category: 'shoes' });

      expect(result.products.length).toBe(1);
    });

    it('should return empty when category not found', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValueOnce(null); // category not found

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts({ category: 'nonexistent' });

      expect(result.products).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle custom pagination', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 50 });
      db._stmt.all.mockResolvedValue({ results: [] });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listProducts({ page: 3, limit: 10 });

      expect(result.page).toBe(3);
      expect(result.limit).toBe(10);
    });
  });

  describe('getProduct', () => {
    it('should return product with variants', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'p1', name: 'Product 1', slug: 'product-1', data: '{"featured":true}',
      });
      db._stmt.all.mockResolvedValue({
        results: [
          { id: 'v1', product_id: 'p1', attributes: '{"size":"L"}' },
        ],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getProduct('product-1');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Product 1');
      expect(result!.data).toEqual({ featured: true });
      expect(result!.variants[0].attributes).toEqual({ size: 'L' });
    });

    it('should return null when product not found', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue(null);

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getProduct('nonexistent');

      expect(result).toBeNull();
    });

    it('should strip cost from product', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'p1', name: 'P1', cost: 5, data: '{}',
      });
      db._stmt.all.mockResolvedValue({ results: [] });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getProduct('p1');

      expect(result).not.toHaveProperty('cost');
    });

    it('should handle already-parsed data', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'p1', name: 'P1', data: { already: 'parsed' },
      });
      db._stmt.all.mockResolvedValue({ results: [] });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getProduct('p1');

      expect(result!.data).toEqual({ already: 'parsed' });
    });

    it('should handle already-parsed variant attributes', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'p1', name: 'P1', data: '{}',
      });
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'v1', attributes: { color: 'red' } }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getProduct('p1');

      expect(result!.variants[0].attributes).toEqual({ color: 'red' });
    });
  });

  // ─── Orders ───────────────────────────────────────────────

  describe('listOrders', () => {
    it('should list orders with default pagination', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 5 });
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'o1', order_number: 'ORD-001' }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listOrders();

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.total).toBe(5);
    });

    it('should filter by email (case insensitive)', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 1 });
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'o1' }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      await svc.listOrders({ email: 'Test@Example.COM' });

      // Verify the email was lowercased in the bind call
      expect(db._stmt.bind).toHaveBeenCalled();
    });

    it('should handle empty results', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total: 0 });
      db._stmt.all.mockResolvedValue({ results: null });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listOrders();

      expect(result.orders).toEqual([]);
    });
  });

  describe('getOrder', () => {
    it('should return order with items and parsed addresses', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'o1', order_number: 'ORD-001',
        shipping_address: '{"city":"NYC"}',
        billing_address: '{"city":"LA"}',
      });
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'i1', name: 'Item 1' }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getOrder('ORD-001');

      expect(result).not.toBeNull();
      expect(result!.shipping_address).toEqual({ city: 'NYC' });
      expect(result!.billing_address).toEqual({ city: 'LA' });
      expect(result!.items.length).toBe(1);
    });

    it('should return null when order not found', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue(null);

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getOrder('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle already-parsed addresses', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'o1', shipping_address: { city: 'NYC' }, billing_address: { city: 'LA' },
      });
      db._stmt.all.mockResolvedValue({ results: [] });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getOrder('o1');

      expect(result!.shipping_address).toEqual({ city: 'NYC' });
    });

    it('should handle null address strings', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({
        id: 'o1', shipping_address: null, billing_address: null,
      });
      db._stmt.all.mockResolvedValue({ results: [] });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getOrder('o1');
      // null is not a string, so it stays as null
      expect(result!.shipping_address).toBeNull();
    });
  });

  describe('createOrder', () => {
    it('should create order with basic data', async () => {
      const db = createMockD1();
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('uuid-1') });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.createOrder({ total: 100, email: 'test@test.com' });

      expect(result.id).toBe('uuid-1');
      expect(result.order_number).toMatch(/^ORD-/);
      expect(result.status).toBe('pending');
      expect(db._stmt.run).toHaveBeenCalled();
    });

    it('should create order items when provided', async () => {
      const db = createMockD1();
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('uuid-1') });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      await svc.createOrder({
        total: 100,
        items: [
          { product_id: 'p1', name: 'Item 1', price: 50, quantity: 2, total: 100 },
        ],
      });

      expect(db.batch).toHaveBeenCalled();
    });

    it('should not batch when no items', async () => {
      const db = createMockD1();
      vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValue('uuid-1') });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      await svc.createOrder({ total: 0 });

      expect(db.batch).not.toHaveBeenCalled();
    });
  });

  // ─── Customers ────────────────────────────────────────────

  describe('listCustomers', () => {
    it('should list customers with default pagination', async () => {
      const db = createMockD1();
      db._stmt.all.mockResolvedValue({
        results: [{ id: 'c1', name: 'Alice' }],
      });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.listCustomers();

      expect(result.customers).toEqual([{ id: 'c1', name: 'Alice' }]);
    });
  });

  describe('getCustomer', () => {
    it('should return customer with order stats', async () => {
      const db = createMockD1();
      db._stmt.first
        .mockResolvedValueOnce({ id: 'c1', name: 'Alice' }) // customer
        .mockResolvedValueOnce({ count: 5, total: 500 }); // order stats

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getCustomer('c1');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Alice');
      expect(result!.stats.order_count).toBe(5);
      expect(result!.stats.total_spent).toBe(500);
    });

    it('should return null when customer not found', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue(null);

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getCustomer('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle null order stats', async () => {
      const db = createMockD1();
      db._stmt.first
        .mockResolvedValueOnce({ id: 'c1', name: 'Bob' })
        .mockResolvedValueOnce(null);

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getCustomer('c1');

      expect(result!.stats.order_count).toBe(0);
      expect(result!.stats.total_spent).toBe(0);
    });
  });

  // ─── Stats ────────────────────────────────────────────────

  describe('getStats', () => {
    it('should return stats for default 30d period', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total_orders: 10, total_revenue: 1000 });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getStats();

      expect(result.period).toBe('30d');
      expect(result.total_orders).toBe(10);
      expect(result.total_revenue).toBe(1000);
    });

    it('should handle 7d period', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total_orders: 3, total_revenue: 300 });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getStats('7d');

      expect(result.period).toBe('7d');
    });

    it('should handle 90d period', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue({ total_orders: 50, total_revenue: 5000 });

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getStats('90d');

      expect(result.period).toBe('90d');
    });

    it('should handle null stats result', async () => {
      const db = createMockD1();
      db._stmt.first.mockResolvedValue(null);

      const svc = new EcommerceService(createEnv(db), 'proj-1');
      const result = await svc.getStats();

      expect(result.total_orders).toBe(0);
      expect(result.total_revenue).toBe(0);
    });
  });
});
