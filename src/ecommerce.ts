import { AerostackEnv } from './server-types';

export class EcommerceService {
    private db: D1Database;

    constructor(private env: AerostackEnv, private projectId: string) {
        // Fallback to env.DB if DB_ECOMMERCE is not present (common in single-DB setups)
        this.db = (env.DB_ECOMMERCE || env.DB) as D1Database;
        if (!this.db) {
            throw new Error('Database binding (DB or DB_ECOMMERCE) not found');
        }
    }

    // --- Products ---

    async listProducts(options: any = {}) {
        const { page = 1, limit = 20, category, status = 'published' } = options;
        const offset = (page - 1) * limit;

        let query = `
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            WHERE p.project_id = ? AND p.status = ?
        `;
        const params: any[] = [this.projectId, status];

        if (category) {
            const categoryRow = await this.db.prepare(`
                SELECT id FROM product_categories 
                WHERE project_id = ? AND (slug = ? OR id = ?)
            `).bind(this.projectId, category, category).first<{ id: string }>();

            if (categoryRow) {
                query += ` AND p.category_id = ?`;
                params.push(categoryRow.id);
            } else {
                return { products: [], total: 0, page, limit };
            }
        }

        const countQuery = query.replace('SELECT p.*, c.name as category_name', 'SELECT COUNT(*) as total');
        const totalResult = await this.db.prepare(countQuery).bind(...params).first<{ total: number }>();
        const total = totalResult?.total ?? 0;

        query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const { results } = await this.db.prepare(query).bind(...params).all();

        // Fetch variants for all products
        const productIds = results.map((p: any) => p.id);
        let variantsByProduct: Record<string, any[]> = {};

        if (productIds.length > 0) {
            const placeholders = productIds.map(() => '?').join(',');
            const { results: allVariants } = await this.db.prepare(`
                SELECT * FROM product_variants WHERE product_id IN (${placeholders})
            `).bind(...productIds).all();

            (allVariants || []).forEach((v: any) => {
                if (!variantsByProduct[v.product_id]) {
                    variantsByProduct[v.product_id] = [];
                }
                variantsByProduct[v.product_id].push({
                    ...v,
                    attributes: typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes
                });
            });
        }

        const products = results.map((p: any) => {
            const { cost: _cost, ...rest } = p;
            let variants = variantsByProduct[p.id] || [];

            // Synthesize virtual variant if none exist
            if (variants.length === 0) {
                variants = [{
                    id: p.id,
                    product_id: p.id,
                    project_id: p.project_id,
                    name: p.name,
                    sku: p.sku || null,
                    price: p.base_price,
                    compare_at_price: p.compare_at_price,
                    stock_quantity: 0,
                    track_inventory: 0,
                    attributes: {},
                    image_url: p.thumbnail_url,
                    created_at: p.created_at,
                    updated_at: p.updated_at
                }];
            }

            return {
                ...rest,
                data: typeof p.data === 'string' ? JSON.parse(p.data) : p.data,
                variants
            };
        });

        return { products, total, page, limit };
    }

    async getProduct(slugOrId: string) {
        const product = await this.db.prepare(`
            SELECT p.*, c.name as category_name
            FROM products p
            LEFT JOIN product_categories c ON p.category_id = c.id
            WHERE p.project_id = ? AND (p.slug = ? OR p.id = ?)
        `).bind(this.projectId, slugOrId, slugOrId).first();

        if (!product) return null;

        const { results: variants } = await this.db.prepare(`
            SELECT * FROM product_variants WHERE product_id = ?
        `).bind(product.id).all();

        const { cost: _cost, ...productRest } = product as any;
        return {
            ...productRest,
            data: typeof product.data === 'string' ? JSON.parse(product.data) : product.data,
            variants: variants.map((v: any) => ({
                ...v,
                attributes: typeof v.attributes === 'string' ? JSON.parse(v.attributes) : v.attributes
            }))
        };
    }

    // --- Orders ---

    async listOrders(options: any = {}) {
        const { page = 1, limit = 20, email } = options;
        const offset = (page - 1) * limit;

        let query = `
            SELECT id, order_number, status, payment_status, currency, grand_total, created_at, email
            FROM orders WHERE project_id = ?
        `;
        const params: any[] = [this.projectId];

        if (email) {
            query += ` AND LOWER(email) = ?`;
            params.push(email.toLowerCase());
        }

        const countQuery = query.replace('SELECT id, order_number, status, payment_status, currency, grand_total, created_at, email', 'SELECT COUNT(*) as total');
        const totalResult = await this.db.prepare(countQuery).bind(...params).first<{ total: number }>();
        const total = totalResult?.total ?? 0;

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const { results } = await this.db.prepare(query).bind(...params).all();

        return { orders: results || [], total, page, limit };
    }

    async getOrder(id: string) {
        // ID could be UUID or order number
        const order = await this.db.prepare(
            'SELECT * FROM orders WHERE project_id = ? AND (id = ? OR order_number = ?)'
        ).bind(this.projectId, id, id).first<any>();

        if (!order) return null;

        const { results: items } = await this.db.prepare(
            'SELECT * FROM order_items WHERE order_id = ?'
        ).bind(order.id).all();

        return {
            ...order,
            shipping_address: typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address || '{}') : order.shipping_address,
            billing_address: typeof order.billing_address === 'string' ? JSON.parse(order.billing_address || '{}') : order.billing_address,
            items: items || []
        };
    }

    async createOrder(data: any) {
        // Minimal stub for hook verification
        const id = crypto.randomUUID();
        const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;

        // Insert order (simplified)
        await this.db.prepare(`
            INSERT INTO orders (id, project_id, order_number, status, payment_status, currency, grand_total, email, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', 'unpaid', 'USD', ?, ?, ?, ?)
        `).bind(id, this.projectId, orderNumber, data.total || 0, data.email || 'test@example.com', Date.now(), Date.now()).run();

        // Insert items if provided
        if (data.items && Array.isArray(data.items)) {
            const stmt = this.db.prepare(`
                INSERT INTO order_items (id, order_id, product_id, name, price, quantity, total)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const batch = data.items.map((item: any) => stmt.bind(
                crypto.randomUUID(), id, item.product_id, item.name, item.price, item.quantity, item.total
            ));
            await this.db.batch(batch);
        }

        return {
            id,
            order_number: orderNumber,
            status: 'pending'
        };
    }

    // --- Customers ---

    async listCustomers(options: any = {}) {
        const { page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;

        const { results } = await this.db.prepare(
            'SELECT * FROM customers WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).bind(this.projectId, limit, offset).all<any>();

        return { customers: results };
    }

    async getCustomer(id: string) {
        const customer = await this.db.prepare(
            'SELECT * FROM customers WHERE project_id = ? AND id = ?'
        ).bind(this.projectId, id).first<any>();

        if (!customer) return null;

        const orderStats = await this.db.prepare(
            'SELECT COUNT(*) as count, SUM(grand_total) as total FROM orders WHERE customer_id = ?'
        ).bind(customer.id).first<{ count: number, total: number }>();

        return {
            ...customer,
            stats: {
                order_count: orderStats?.count || 0,
                total_spent: orderStats?.total || 0
            }
        };
    }

    async getStats(period: string = '30d') {
        // Simple period parsing
        let days = 30;
        if (period === '7d') days = 7;
        if (period === '90d') days = 90;
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);

        const result = await this.db.prepare(`
            SELECT 
                COUNT(*) as total_orders, 
                SUM(grand_total) as total_revenue
            FROM orders 
            WHERE project_id = ? AND created_at > ?
        `).bind(this.projectId, since).first<{ total_orders: number, total_revenue: number }>();

        return {
            period,
            total_orders: result?.total_orders || 0,
            total_revenue: result?.total_revenue || 0
        };
    }
}
