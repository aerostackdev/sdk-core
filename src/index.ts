// Client SDK - Authentication-focused
import { AerostackClient } from './client';
// Server SDK - Full backend platform
import { AerostackServer } from './server';

// Convenience re-exports
export { AerostackClient, AerostackServer };
export * from './client';
export * from './server';
export * from './realtime';

// "Unified SDK" instance for convenience
// Note: In server environments, it will need to be initialized with env
// In client environments, it serves as the primary entry point
export const sdk = {
    _server: null as AerostackServer | null,
    _client: null as AerostackClient | null,

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
    get auth() {
        if (!this._client) throw new Error('SDK not initialized. Call sdk.init({ projectSlug: "..." }) first.');
        return this._client.auth;
    },

    /**
     * Initialize the SDK
     * - Pass a projectSlug (string) to initialize as a Client
     * - Pass the Workers 'env' object to initialize as a Server
     */
    init(config: any) {
        if (typeof config === 'object' && config.projectSlug) {
            this._client = new AerostackClient(config);
        } else {
            this._server = new AerostackServer(config);
        }
    }
};
