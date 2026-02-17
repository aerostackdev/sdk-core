import { AerostackServer } from '@aerostack/sdk';

/**
 * Database Only Example (Server SDK)
 * 
 * Demonstrates how to use the Aerostack Server SDK for direct database access.
 * This pattern is ONLY available in Cloudflare Workers because it uses bindings.
 */

// Mock Env for type checking (in a real Worker, this comes from the fetch handler)
interface Env {
    DB: any; // D1Database
    CACHE: any; // KVNamespace
    QUEUE: any;
    STORAGE: any;
    AI: any;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const server = new AerostackServer(env);

        try {
            // 1. Run a simple query
            // The SDK automatically routes to D1 or Postgres based on configuration
            const result = await server.db.query('SELECT 1 as health_check');

            // 2. Insert data
            // Note: In D1, use ? placeholders. In Postgres, simpler to use standard SQL.
            await server.db.query(
                'INSERT INTO access_logs (url, method, timestamp) VALUES (?, ?, ?)',
                [request.url, request.method, new Date().toISOString()]
            );

            return Response.json({
                success: true,
                data: result.results
            });

        } catch (error: any) {
            return Response.json(
                { error: error.message },
                { status: 500 }
            );
        }
    }
};
