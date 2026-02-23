// Client SDK - Authentication-focused
import { AerostackClient } from './client';
// Server SDK - Full backend platform
import { AerostackServer } from './server';
import { AerostackCommunity } from './community';

// Convenience re-exports
export { AerostackClient, AerostackServer, AerostackCommunity };
export * from './client';
export * from './server';
export * from './realtime';
export * from './community';

/**
 * Unified SDK singleton for convenience.
 * 
 * ⚠️ **Important**: This singleton can only be initialized in ONE mode:
 * - Client mode (Auth, API calls) when `projectSlug` is provided
 * - Server mode (DB, Queue, Storage) when only `env` is provided
 * 
 * **For Backend Wrappers**: If you need BOTH Auth AND DB features in the same Worker,
 * use direct instantiation instead:
 * 
 * @example
 * ```typescript
 * // ✅ Recommended: Direct instantiation for dual-mode
 * const client = new AerostackClient({ projectSlug: "my-project" });
 * const server = new AerostackServer(env);
 * 
 * // Use both simultaneously
 * const { user, token } = await client.auth.register({ email, password });
 * await server.db.query('INSERT INTO users ...', [user.id]);
 * ```
 * 
 * @example
 * ```typescript
 * // ⚠️ Singleton (can't use both modes together)
 * sdk.init({ projectSlug: "my-project" }); // Client mode
 * sdk.auth.login(...); // ✅ Works
 * sdk.db.query(...);   // ❌ Error: "SDK not initialized"
 * ```
 */
export const sdk = {
    _server: null as AerostackServer | null,
    _client: null as AerostackClient | null,
    _community: null as AerostackCommunity | null,

    get community() {
        if (!this._community) {
            this._community = new AerostackCommunity();
        }
        return this._community;
    },

    get db() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.db;
    },
    get cache() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.cache;
    },
    get queue() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.queue;
    },
    get storage() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.storage;
    },
    get ai() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.ai;
    },
    get services() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.services;
    },
    get ecommerce() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.ecommerce;
    },
    get socket() {
        if (!this._server) throw new Error('SDK not initialized. Call sdk.init(env) first.');
        return this._server.socket;
    },
    get auth() {
        if (this._client) return this._client.auth;
        if (this._server) return this._server.auth as any;
        throw new Error('SDK not initialized. Call sdk.init(...) first.');
    },

    /**
     * Initialize the SDK
     * - Pass a projectSlug (string) to initialize as a Client
     * - Pass the Workers 'env' object and optional AerostackOptions to initialize as a Server
     */
    init(config: any, options?: any) {
        if (typeof config === 'object' && config.projectSlug) {
            this._client = new AerostackClient(config);
        } else {
            this._server = new AerostackServer(config, options);
        }
    }
};
