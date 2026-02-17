/**
 * Backend Wrapper Pattern Example
 * 
 * This example shows how to use both AerostackClient (for Auth/API calls)
 * and AerostackServer (for DB/Queue/Storage) in the same Worker.
 * 
 * Use Case: A backend service that wraps Aerostack's Auth and E-commerce APIs
 * while also performing custom database operations.
 */

import { AerostackClient, AerostackServer } from '@aerostack/sdk';

// Define your Worker environment bindings
// Note: In production, install @cloudflare/workers-types for proper typing
export interface Env {
    PROJECT_SLUG: string;
    ADMIN_API_KEY?: string;
    API_URL?: string;
    // Cloudflare bindings (simplified typings for example purposes)
    DB: any; // D1Database
    CACHE: any; // KVNamespace
    QUEUE: any; // Queue
    STORAGE: any; // R2Bucket
    AI: any; // Ai
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        // Initialize both Client and Server SDKs
        const client = new AerostackClient({
            projectSlug: env.PROJECT_SLUG,
            // 🔐 IMPORTANT: Use your Admin API Key for server-side auth operations
            apiKey: env.ADMIN_API_KEY,
            // Optional: Point to local API during development
            baseUrl: env.API_URL || 'https://api.aerostack.ai/v1'
        });

        const server = new AerostackServer(env);

        const url = new URL(request.url);

        // Example 1: Custom Registration with Organization Setup
        if (url.pathname === '/api/register-with-org' && request.method === 'POST') {
            try {
                const { email, password, companyName } = await request.json();

                // 1. Register user via Client SDK (handles password hashing, token generation)
                const authResponse = await client.auth.register({
                    email,
                    password,
                    name: companyName
                });

                if (!authResponse.user || !authResponse.token) {
                    return Response.json(
                        { success: false, error: 'Registration failed' },
                        { status: 400 }
                    );
                }

                const { user, token } = authResponse;

                // 2. Create organization in custom DB table via Server SDK
                const org = await server.db.query(
                    'INSERT INTO organizations (name, owner_id, created_at) VALUES (?, ?, ?) RETURNING *',
                    [companyName, user.id, new Date().toISOString()]
                );

                // 3. Add user as organization admin
                await server.db.query(
                    'INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)',
                    [org.results[0].id, user.id, 'owner']
                );

                // 4. Send welcome email via Queue
                await server.queue.enqueue({
                    type: 'send-email',
                    data: {
                        to: email,
                        template: 'welcome-org',
                        variables: { userName: user.name, orgName: companyName }
                    }
                });

                return Response.json({
                    success: true,
                    user,
                    token,
                    organization: org.results[0]
                });
            } catch (error: any) {
                return Response.json(
                    { success: false, error: error.message },
                    { status: 400 }
                );
            }
        }

        // Example 2: Custom E-commerce Flow with Analytics
        if (url.pathname === '/api/checkout' && request.method === 'POST') {
            try {
                const { userId, items, couponCode } = await request.json();
                const authToken = request.headers.get('Authorization')?.replace('Bearer ', '');

                if (!authToken) {
                    return Response.json({ error: 'Unauthorized' }, { status: 401 });
                }

                // 1. Verify user session via Client SDK
                const user = await client.auth.getCurrentUser(authToken);

                // 2. Validate coupon if provided (via your own DB logic)
                let discount = 0;
                if (couponCode) {
                    const coupon = await server.db.query(
                        'SELECT * FROM coupons WHERE code = ? AND expires_at > ? AND used_count < max_uses',
                        [couponCode, new Date().toISOString()]
                    );

                    if (coupon.results.length > 0) {
                        discount = coupon.results[0].discount_percent;
                    }
                }

                // 3. Calculate total (simplified example)
                const subtotal = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
                const total = subtotal * (1 - discount / 100);

                // 4. Create order via Server SDK
                const order = await server.db.query(
                    'INSERT INTO orders (user_id, subtotal, discount, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
                    [user.id, subtotal, discount, total, 'pending', new Date().toISOString()]
                );

                // 5. Log analytics event
                await server.db.query(
                    'INSERT INTO analytics_events (event_type, user_id, metadata, created_at) VALUES (?, ?, ?, ?)',
                    ['checkout_completed', user.id, JSON.stringify({ orderId: order.results[0].id, total }), new Date().toISOString()]
                );

                // 6. Enqueue payment processing
                await server.queue.enqueue({
                    type: 'process-payment',
                    data: {
                        orderId: order.results[0].id,
                        amount: total,
                        userId: user.id
                    }
                });

                return Response.json({
                    success: true,
                    order: order.results[0]
                });
            } catch (error: any) {
                return Response.json(
                    { success: false, error: error.message },
                    { status: 400 }
                );
            }
        }

        // Example 3: Admin-only User Management Endpoint
        if (url.pathname === '/api/admin/users' && request.method === 'GET') {
            try {
                const authToken = request.headers.get('Authorization')?.replace('Bearer ', '');

                if (!authToken) {
                    return Response.json({ error: 'Unauthorized' }, { status: 401 });
                }

                // 1. Verify admin user via Client SDK
                const user = await client.auth.getCurrentUser(authToken);

                // 2. Check admin role via Server SDK
                const adminCheck = await server.db.query(
                    'SELECT role FROM org_members WHERE user_id = ?',
                    [user.id]
                );

                if (adminCheck.results.length === 0 || adminCheck.results[0].role !== 'owner') {
                    return Response.json({ error: 'Forbidden' }, { status: 403 });
                }

                // 3. Get all users in organization
                const users = await server.db.query(
                    'SELECT u.id, u.email, u.name, om.role FROM users u JOIN org_members om ON u.id = om.user_id WHERE om.org_id = (SELECT org_id FROM org_members WHERE user_id = ?)',
                    [user.id]
                );

                return Response.json({
                    success: true,
                    users: users.results
                });
            } catch (error: any) {
                return Response.json(
                    { success: false, error: error.message },
                    { status: 400 }
                );
            }
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
    }
};
