import type { Pool } from '@neondatabase/serverless';
import {
    DatabaseError,
    CacheError,
    QueueError,
    StorageError,
    AIError,
    ServiceError,
    ErrorCode,
} from './server-errors';
import type {
    DatabaseResponse,
    RoutingRules,
    SchemaInfo,
    SchemaTable,
    Transaction,
    BatchQuery,
    BatchResult,
    CacheOptions,
    CacheGetOptions,
    Job,
    JobResult,
    JobStatus,
    UploadOptions,
    UploadResult,
    UrlOptions,
    StorageObject,
    Message,
    ChatOptions,
    ChatResponse,
    EmbedOptions,
    Embedding,
    SearchOptions,
    IngestOptions,
    SearchResult,
    Product,
    FAQ,
    SearchContent,
    TypeStats,
    SearchConfigureOptions,
    GenerateOptions,
    GenerationResult,
    InvokeOptions,
    AuthContext,
    AuthHookResult,
    AerostackEnv,
    AerostackOptions,
} from './server-types';

/**
 * AerostackServer provides comprehensive server-side SDK for Cloudflare Workers
 * 
 * Features:
 * - Multi-database operations (D1 + Postgres with intelligent routing)
 * - KV cache operations
 * - Queue operations for background jobs
 * - R2 storage operations
 * - AI operations (chat, embeddings, generation)
 * - Service invocation via Workers Dispatch
 */
export class AerostackServer {
    private pgPool?: Pool;
    private _d1?: D1Database;
    private _kv?: KVNamespace;
    private _queue?: Queue;
    private _storage?: R2Bucket;
    private _ai?: Ai;
    private _dispatcher?: DurableObjectNamespace;
    private _projectId?: string;
    private _authToken?: string;
    private _hookId?: string;
    private _dispatchToken?: string;
    private _platformUrl?: string;
    private routingRules: RoutingRules;
    private env: AerostackEnv;

    private async initPostgres(env: AerostackEnv) {
        const pgConnStr = this.findPostgresConnStr(env);

        if (pgConnStr) {
            try {
                // Dynamically import to prevent bloating the base SDK bundle for users who don't use Postgres
                const { Pool } = await import('@neondatabase/serverless');
                this.pgPool = new Pool({ connectionString: pgConnStr });

                console.log("Aerostack: Postgres initialized successfully with", pgConnStr.split('@')[1] || "connection string");
            } catch (err) {

                console.error("Aerostack: Failed to load @neondatabase/serverless. Postgres is configured but the driver could not be loaded.", err);
            }
        }
    }

    private _initPromise: Promise<void>;

    constructor(env: AerostackEnv, options: AerostackOptions = {}) {
        this.env = env;
        this._d1 = env.DB;
        this._kv = env.CACHE;
        this._queue = env.QUEUE;
        this._ai = env.AI;
        this._dispatcher = env.DISPATCHER;
        this.routingRules = options.routing || { tables: {} };
        this._hookId = options.hookId || '';

        // Bootstrap auth from x-as-* dispatch headers ONLY when env bindings are
        // genuinely empty (dispatch namespace scenario). This prevents external callers
        // from injecting these headers to spoof auth context.
        const req = options.request;
        const envIsEmpty = !env.AEROSTACK_PROJECT_ID && !env.AEROSTACK_API_KEY && !env.DB && !env.CACHE;
        this._projectId = options.projectId || env.AEROSTACK_PROJECT_ID
            || (envIsEmpty ? req?.headers?.get('x-as-project-id') : undefined) || undefined;
        this._authToken = options.authToken || env.AEROSTACK_API_KEY
            || (envIsEmpty ? req?.headers?.get('x-as-service-token') : undefined) || undefined;
        this._dispatchToken = (envIsEmpty ? req?.headers?.get('x-as-dispatch-token') : undefined) || undefined;
        this._platformUrl = (envIsEmpty ? req?.headers?.get('x-as-platform-url') : undefined) || undefined;

        // Storage initialization logic
        if (options.storage) {
            // 1. Direct R2Bucket instance provided
            this._storage = options.storage;
        } else if (options.storageBinding) {
            // 2. Custom binding name provided
            this._storage = env[options.storageBinding] as R2Bucket;
        } else {
            // 3. Default to env.STORAGE
            this._storage = env.STORAGE;
        }

        // Project ID for storage isolation (already set above with header fallback)

        // Async init for dynamic dependencies
        this._initPromise = this.initPostgres(env);
    }

    private async _rpcCall(serviceName: string, method: string, args: any[]) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        // Auth: prefer dispatch token (injected by platform at invocation time),
        // then API key (set in env or via x-as-service-token header)
        if (this._dispatchToken && this._projectId) {
            headers['x-as-dispatch-token'] = this._dispatchToken;
            headers['x-as-project-id'] = this._projectId;
        } else if (this._authToken) {
            headers['Authorization'] = `Bearer ${this._authToken}`;
        }

        // 1. Try Service Binding (API) if available and target is 'internal'
        // This is the preferred way for Workers to talk to the main API
        if (serviceName === 'internal' && this.env.API) {
            const res = await this.env.API.fetch('http://internal/internal/hooks/rpc', {
                method: 'POST',
                headers,
                body: JSON.stringify({ method, args, projectId: this._projectId ?? undefined })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`Aerostack connection error (${res.status}): ${errText} [Internal: Service Binding ${method}]`);
            }
            return this._parseRpcJson(res, method, 'Service Binding');
        }

        // 2. Try HTTP URL: platform URL from dispatch headers → env vars → hardcoded default
        // SSRF guard: validate URL scheme + hostname (same pattern as _storageApiCall)
        const rawApiUrl = this._platformUrl || this.env.API_URL || this.env.AEROSTACK_API_URL || 'https://api.aerostack.dev';
        let apiUrl: string;
        try {
            const u = new URL(rawApiUrl);
            const isLocalDev = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
            const allowed = u.protocol === 'https:' || (u.protocol === 'http:' && isLocalDev);
            apiUrl = allowed ? rawApiUrl : 'https://api.aerostack.dev';
        } catch {
            apiUrl = 'https://api.aerostack.dev';
        }
        if (serviceName === 'internal') {
            try {
                const res = await fetch(`${apiUrl}/internal/hooks/rpc`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ method, args, projectId: this._projectId ?? undefined })
                });
                if (!res.ok) {
                    const errText = await res.text();
                    let errMsg = `Aerostack connection error (${res.status})`;
                    if (res.status === 401) errMsg = "Aerostack authentication failed. Check your AEROSTACK_API_KEY or dispatch token.";
                    if (res.status === 403) errMsg = "RPC endpoints require a secret API key. Public keys cannot access db/cache/storage/ai. Set AEROSTACK_API_KEY to your secret key.";
                    if (res.status === 404) errMsg = `Aerostack resource not found at ${apiUrl}. Check your AEROSTACK_API_URL.`;
                    throw new Error(`${errMsg} [Internal: HTTP ${method} ${res.status}] ${errText}`);
                }
                return this._parseRpcJson(res, method, apiUrl);
            } catch (err: any) {
                // If it's already an error we threw above, just rethrow it
                if (err.message.includes('Aerostack')) throw err;

                // Otherwise, it's a network/fetch error
                throw new Error(
                    `The SDK could not connect to the Aerostack API at ${apiUrl}. ` +
                    `This usually means the API server is not running or the URL is blocked by a firewall/VPN. ` +
                    `If running locally, ensure your API is started on this port. ` +
                    `[Internal: fetch failed: ${err.message}]`
                );
            }
        }

        // 3. Fallback to dispatcher (original logic)
        return this.services.invoke(serviceName, { method, args }, { path: '/internal/hooks/rpc' });
    }

    /**
     * Call a platform storage RPC endpoint at {apiUrl}/v1/storage/{operation}.
     * Used as fallback when no direct R2 binding is configured (platform storage model).
     */
    private async _storageApiCall(operation: string, body: FormData | Record<string, any>): Promise<Response> {
        // Allowlist valid operations to prevent URL path traversal
        const VALID_OPS: Record<string, ErrorCode> = {
            upload: ErrorCode.STORAGE_UPLOAD_FAILED,
            getUrl: ErrorCode.STORAGE_NOT_CONFIGURED,
            get: ErrorCode.STORAGE_NOT_CONFIGURED,
            delete: ErrorCode.STORAGE_DELETE_FAILED,
            list: ErrorCode.STORAGE_DELETE_FAILED,
            exists: ErrorCode.STORAGE_NOT_CONFIGURED,
            getMetadata: ErrorCode.STORAGE_NOT_CONFIGURED,
            copy: ErrorCode.STORAGE_UPLOAD_FAILED,
            move: ErrorCode.STORAGE_UPLOAD_FAILED,
        };
        if (!(operation in VALID_OPS)) {
            throw new StorageError(ErrorCode.STORAGE_UPLOAD_FAILED, `Invalid storage operation: ${operation}`, {});
        }

        // SSRF guard: parse URL and verify scheme + hostname explicitly
        const rawUrl = this._platformUrl || this.env.API_URL || this.env.AEROSTACK_API_URL || 'https://api.aerostack.dev';
        let apiUrl: string;
        try {
            const u = new URL(rawUrl);
            const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
            apiUrl = (isLocalhost && u.protocol === 'http:') || u.protocol === 'https:'
                ? rawUrl
                : 'https://api.aerostack.dev';
        } catch {
            apiUrl = 'https://api.aerostack.dev';
        }

        const headers: Record<string, string> = {};
        // Auth: dispatch token or API key
        if (this._dispatchToken && this._projectId) {
            headers['x-as-dispatch-token'] = this._dispatchToken;
            headers['x-as-project-id'] = this._projectId;
        } else if (this._authToken) {
            headers['Authorization'] = `Bearer ${this._authToken}`;
        }

        let fetchBody: BodyInit;
        if (body instanceof FormData) {
            fetchBody = body;
            // Do NOT set Content-Type for FormData — fetch sets it with the boundary automatically
        } else {
            headers['Content-Type'] = 'application/json';
            fetchBody = JSON.stringify(body);
        }

        const res = await fetch(`${apiUrl}/v1/storage/${operation}`, {
            method: 'POST',
            headers,
            body: fetchBody,
            signal: AbortSignal.timeout(25000),
        });

        if (!res.ok) {
            const errText = await res.text();
            let msg = `Storage ${operation} failed (${res.status})`;
            if (res.status === 401) msg = 'Aerostack authentication failed. Check your AEROSTACK_API_KEY.';
            if (res.status === 403) msg = 'Storage requires a secret API key. Public keys cannot access RPC endpoints. Set AEROSTACK_API_KEY to your secret key (starts with "sk_" or found in your dashboard under API Keys > Secret).';
            if (res.status === 415) msg = 'Storage upload rejected: server expected multipart/form-data. This is a platform bug — please report it.';
            throw new StorageError(VALID_OPS[operation], msg, { cause: errText });
        }

        return res;
    }

    /**
     * Call a platform AI RPC endpoint at {apiUrl}/v1/ai/{path}.
     * Used as fallback when no direct AI binding is configured (platform model).
     */
    private async _aiApiCall(path: string, body?: Record<string, any>, method: 'POST' | 'GET' = 'POST'): Promise<any> {
        // Pre-flight: require auth token or dispatch token when using RPC path
        if (!this._authToken && !this._dispatchToken) {
            throw new AIError(
                ErrorCode.AI_REQUEST_FAILED,
                'AEROSTACK_API_KEY is required for platform AI operations. Set it in your environment or pass authToken in options.',
                {}
            );
        }

        // Allowlist valid operations to prevent URL path traversal
        const VALID_PATHS = new Set([
            'chat',
            'embed',
            'search/ingest',
            'search/query',
            'search/delete',
            'search/deleteByType',
            'search/listTypes',
            'search/configure',
            'search/update',
            'search/get',
            'search/count',
        ]);
        if (!VALID_PATHS.has(path)) {
            throw new AIError(ErrorCode.AI_REQUEST_FAILED, `Invalid AI operation: ${path}`, {});
        }

        // SSRF guard: parse URL and verify scheme + hostname explicitly
        // Allow https:// (any host) or http://localhost|127.0.0.1 (local dev only).
        // Reject http:// to private RFC-1918/IPv6 ranges.
        const rawUrl = this._platformUrl || this.env.API_URL || this.env.AEROSTACK_API_URL || 'https://api.aerostack.dev';
        let apiUrl: string;
        try {
            const u = new URL(rawUrl);
            const h = u.hostname;
            const isLocalDev =
                h === 'localhost' ||
                h === '127.0.0.1' ||
                h === '[::1]';
            const isPrivate =
                /^10\./.test(h) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
                /^192\.168\./.test(h) ||
                h === '169.254.169.254'; // cloud metadata endpoint
            const allowed =
                u.protocol === 'https:' ||
                (u.protocol === 'http:' && isLocalDev && !isPrivate);
            apiUrl = allowed ? rawUrl : 'https://api.aerostack.dev';
        } catch {
            apiUrl = 'https://api.aerostack.dev';
        }

        const headers: Record<string, string> = {};
        // Auth: dispatch token or API key
        if (this._dispatchToken && this._projectId) {
            headers['x-as-dispatch-token'] = this._dispatchToken;
            headers['x-as-project-id'] = this._projectId;
        } else if (this._authToken) {
            headers['Authorization'] = `Bearer ${this._authToken}`;
        }
        if (method !== 'GET') {
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(`${apiUrl}/v1/ai/${path}`, {
            method,
            headers,
            ...(method !== 'GET' && body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(60000), // AI calls can be slow
        });

        if (!res.ok) {
            const errText = await res.text();
            let msg = `AI ${path} failed (${res.status})`;
            if (res.status === 401) msg = 'Aerostack authentication failed. Check your AEROSTACK_API_KEY or dispatch token.';
            if (res.status === 403) msg = 'API key does not have permission for AI operations. Check your key scopes.';
            throw new AIError(ErrorCode.AI_REQUEST_FAILED, msg, { cause: errText });
        }

        return res.json();
    }

    /** Parse RPC response as JSON; throw a clear error if body is not valid JSON (e.g. worker default handler returned plain text) */
    private async _parseRpcJson(res: Response, method: string, source: string): Promise<any> {
        const text = await res.text();
        try {
            return text ? JSON.parse(text) : null;
        } catch {
            const preview = text.length > 80 ? text.slice(0, 80) + '...' : text;
            throw new Error(
                `Failed to communicate with Aerostack API at ${source}. ` +
                `This usually means your AEROSTACK_API_URL points to the wrong service (like your own worker) or the API is unavailable. ` +
                `Ensure AEROSTACK_API_URL is set to a valid Aerostack API (e.g., https://api.aerostack.dev). ` +
                `[Internal: ${method} expected JSON, received "${preview}"]`
            );
        }
    }

    /**
     * Database operations with intelligent routing between D1 and Postgres
     */
    get db() {
        return {
            /**
             * Execute a SQL query with automatic routing
             */
            query: async <T = any>(sql: string, params: any[] = []): Promise<DatabaseResponse<T>> => {
                await this._initPromise;
                return this.routeQuery<T>(sql, params);
            },

            /**
             * Get database schema information
             */
            getSchema: async (binding?: string): Promise<SchemaInfo> => {
                await this._initPromise; // ensure postgres is loaded if configured

                // If binding specified, get schema for that specific database
                if (binding) {
                    const isPg = binding.toLowerCase().includes('pg') || binding.toLowerCase().includes('postgres');
                    if (this.pgPool && isPg) {
                        return this.introspectPostgres();
                    }
                    if (this._d1) {
                        return this.introspectD1();
                    }
                }

                // Default: Prioritize Postgres if available (likely Neon/External)
                if (this.pgPool) {
                    return this.introspectPostgres();
                }

                // Fallback to D1
                if (this._d1) {
                    return this.introspectD1();
                }

                throw new DatabaseError(
                    ErrorCode.DB_CONNECTION_FAILED,
                    'No database connection available',
                    {
                        suggestion: 'Configure DB or Postgres connection in aerostack.toml',
                    }
                );
            },

            /**
             * Execute multiple queries in a batch
             */
            batch: async (queries: BatchQuery[]): Promise<BatchResult> => {
                await this._initPromise;
                const results: DatabaseResponse[] = [];
                const errors: Array<{ index: number; error: Error }> = [];
                let success = true;

                for (let i = 0; i < queries.length; i++) {
                    try {
                        const result = await this.routeQuery(queries[i].sql, queries[i].params || []);
                        results.push(result);
                    } catch (error: any) {
                        success = false;
                        errors.push({ index: i, error });
                        results.push({
                            results: [],
                            success: false,
                            meta: { target: 'd1' },
                        });
                    }
                }

                return { results, success, errors: errors.length > 0 ? errors : undefined };
            },
        };
    }

    /**
     * KV Cache operations
     */
    get cache() {
        return {
            /**
             * Get value from cache
             */
            get: async <T = any>(key: string, options?: CacheGetOptions): Promise<T | null> => {
                if (!this._kv) {
                    return this._rpcCall('internal', 'cache.get', [key]) as Promise<T | null>;
                }

                try {
                    const type = options?.type || 'json';
                    const value = type === 'json'
                        ? await this._kv.get(key, 'json')
                        : type === 'text'
                            ? await this._kv.get(key, 'text')
                            : type === 'arrayBuffer'
                                ? await this._kv.get(key, 'arrayBuffer')
                                : await this._kv.get(key, 'stream' as any);
                    return value as T | null;
                } catch (err: any) {
                    throw new CacheError(
                        ErrorCode.CACHE_GET_FAILED,
                        `Failed to get cache key: ${key}`,
                        {
                            suggestion: 'Check key format and KV namespace binding',
                            cause: err.message,
                        },
                        { key }
                    );
                }
            },

            /**
             * Set value in cache
             */
            set: async (key: string, value: any, options?: CacheOptions): Promise<void> => {
                if (!this._kv) {
                    const ttl = options?.ttl || options?.expirationTtl;
                    await this._rpcCall('internal', 'cache.set', [key, value, ttl]);
                    return;
                }

                try {
                    const ttl = options?.ttl || options?.expirationTtl;
                    await this._kv.put(key, JSON.stringify(value), ttl ? { expirationTtl: ttl } : undefined);
                } catch (err: any) {
                    throw new CacheError(
                        ErrorCode.CACHE_SET_FAILED,
                        `Failed to set cache key: ${key}`,
                        {
                            suggestion: 'Check value serialization and KV limits (25MB)',
                            cause: err.message,
                        },
                        { key, value }
                    );
                }
            },

            /**
             * Delete value from cache
             */
            delete: async (key: string): Promise<void> => {
                if (!this._kv) {
                    await this._rpcCall('internal', 'cache.delete', [key]);
                    return;
                }

                try {
                    await this._kv.delete(key);
                } catch (err: any) {
                    throw new CacheError(
                        ErrorCode.CACHE_DELETE_FAILED,
                        `Failed to delete cache key: ${key}`,
                        { cause: err.message },
                        { key }
                    );
                }
            },

            /**
             * Check if key exists in cache
             */
            exists: async (key: string): Promise<boolean> => {
                if (!this._kv) {
                    const val = await this._rpcCall('internal', 'cache.get', [key]);
                    return val !== null && val !== undefined;
                }

                try {
                    const value = await this._kv.get(key);
                    return value !== null;
                } catch {
                    return false;
                }
            },

            /**
             * List cache keys with optional prefix (paginated)
             */
            list: async (prefix?: string, limit?: number, cursor?: string): Promise<{ keys: Array<{ name: string; expiration?: number }>; list_complete: boolean; cursor?: string }> => {
                if (!this._kv) {
                    return this._rpcCall('internal', 'cache.list', [prefix, { limit, cursor }]) as any;
                }
                try {
                    const result = await this._kv.list({ prefix, limit, cursor });
                    return result as any;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_GET_FAILED, 'Failed to list cache keys', { cause: err.message });
                }
            },

            /**
             * Get all keys matching prefix (auto-paginates, hard cap 10k)
             */
            keys: async (prefix?: string): Promise<string[]> => {
                if (!this._kv) {
                    return this._rpcCall('internal', 'cache.keys', [prefix]) as Promise<string[]>;
                }
                try {
                    const allKeys: string[] = [];
                    let cursor: string | undefined;
                    do {
                        const result: any = await this._kv.list({ prefix, limit: 1000, cursor });
                        for (const k of result.keys) allKeys.push(k.name);
                        cursor = result.list_complete ? undefined : result.cursor;
                        if (allKeys.length >= 10000) break;
                    } while (cursor);
                    return allKeys;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_GET_FAILED, 'Failed to list cache keys', { cause: err.message });
                }
            },

            /**
             * Get multiple keys in one call (up to 100)
             */
            getMany: async <T = any>(keys: string[]): Promise<Array<{ key: string; value: T | null }>> => {
                if (!this._kv) {
                    return this._rpcCall('internal', 'cache.getMany', [keys]) as any;
                }
                try {
                    const results = await Promise.all(
                        keys.map(async (key) => ({ key, value: await this._kv!.get<T>(key, 'json') }))
                    );
                    return results;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_GET_FAILED, 'Failed to get many cache keys', { cause: err.message });
                }
            },

            /**
             * Set multiple key-value pairs in one call (up to 100)
             */
            setMany: async (entries: Array<{ key: string; value: any; ttl?: number }>): Promise<void> => {
                if (!this._kv) {
                    await this._rpcCall('internal', 'cache.setMany', [entries]);
                    return;
                }
                try {
                    await Promise.all(
                        entries.map((e) => this._kv!.put(e.key, JSON.stringify(e.value), e.ttl ? { expirationTtl: e.ttl } : undefined))
                    );
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_SET_FAILED, 'Failed to set many cache keys', { cause: err.message });
                }
            },

            /**
             * Delete multiple keys in one call (up to 500)
             */
            deleteMany: async (keys: string[]): Promise<void> => {
                if (!this._kv) {
                    await this._rpcCall('internal', 'cache.deleteMany', [keys]);
                    return;
                }
                try {
                    await Promise.all(keys.map((key) => this._kv!.delete(key)));
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_DELETE_FAILED, 'Failed to delete many cache keys', { cause: err.message });
                }
            },

            /**
             * Delete all keys matching prefix (or all project keys if no prefix). Hard cap 10k.
             */
            flush: async (prefix?: string): Promise<number> => {
                if (!this._kv) {
                    const result = await this._rpcCall('internal', 'cache.flush', [prefix]) as any;
                    return result?.deleted ?? 0;
                }
                try {
                    const allKeys: string[] = [];
                    let cursor: string | undefined;
                    do {
                        const result: any = await this._kv.list({ prefix, limit: 1000, cursor });
                        for (const k of result.keys) allKeys.push(k.name);
                        cursor = result.list_complete ? undefined : result.cursor;
                        if (allKeys.length >= 10000) break;
                    } while (cursor);
                    await Promise.all(allKeys.map((key) => this._kv!.delete(key)));
                    return allKeys.length;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_DELETE_FAILED, 'Failed to flush cache', { cause: err.message });
                }
            },

            /**
             * Update TTL of an existing key (get-then-put, not atomic)
             */
            expire: async (key: string, ttl: number): Promise<boolean> => {
                if (!this._kv) {
                    const result = await this._rpcCall('internal', 'cache.expire', [key, ttl]) as any;
                    return result?.success ?? false;
                }
                try {
                    const raw = await this._kv.get(key, 'text');
                    if (raw === null) return false;
                    await this._kv.put(key, raw, { expirationTtl: ttl });
                    return true;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_SET_FAILED, `Failed to expire cache key: ${key}`, { cause: err.message });
                }
            },

            /**
             * Increment a numeric counter (read-modify-write, not atomic under high concurrency)
             */
            increment: async (key: string, amount = 1, initialValue = 0, ttl?: number): Promise<number> => {
                if (!this._kv) {
                    const result = await this._rpcCall('internal', 'cache.increment', [key, amount, { initialValue, ttl }]) as any;
                    return result?.value ?? 0;
                }
                try {
                    const raw = await this._kv.get(key, 'text');
                    const current = raw !== null ? parseFloat(raw) : initialValue;
                    const next = current + amount;
                    await this._kv.put(key, String(next), ttl ? { expirationTtl: ttl } : undefined);
                    return next;
                } catch (err: any) {
                    throw new CacheError(ErrorCode.CACHE_SET_FAILED, `Failed to increment cache key: ${key}`, { cause: err.message });
                }
            },
        };
    }

    /**
     * Queue operations for background jobs
     */
    get queue() {
        return {
            /**
             * Add job to queue
             */
            enqueue: async (job: Job): Promise<JobResult> => {
                if (!this._queue) {
                    // Fallback to RPC for managed environments without direct queue binding
                    try {
                        const rpcResult = await this._rpcCall('internal', 'queue.enqueue', [job.type, job.data, job.delay]) as any;
                        return {
                            jobId: rpcResult?.jobId || `rpc_${Date.now()}`,
                            status: 'queued',
                            queuedAt: new Date()
                        };
                    } catch (rpcErr: any) {
                        throw new QueueError(
                            ErrorCode.QUEUE_NOT_CONFIGURED,
                            'Queue not configured and RPC fallback failed',
                            {
                                suggestion: 'Add [[queues]] binding to aerostack.toml or ensure API is reachable',
                                cause: rpcErr.message
                            }
                        );
                    }
                }

                try {
                    const message = {
                        type: job.type,
                        data: job.data,
                        queuedAt: new Date().toISOString(),
                    };

                    await this._queue.send(message, {
                        delaySeconds: job.delay,
                    });

                    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                    return {
                        jobId,
                        status: 'queued',
                        queuedAt: new Date(),
                    };
                } catch (err: any) {
                    throw new QueueError(
                        ErrorCode.QUEUE_ENQUEUE_FAILED,
                        'Failed to enqueue job',
                        {
                            suggestion: 'Check queue binding and message size limits',
                            cause: err.message,
                        },
                        { job }
                    );
                }
            },

            /**
             * Get a job's status by ID
             */
            getJob: async (jobId: string): Promise<{ job: JobStatus | null; exists: boolean }> => {
                try {
                    return await this._rpcCall('internal', 'queue.job', [jobId]) as any;
                } catch (err: any) {
                    throw new QueueError(ErrorCode.QUEUE_NOT_CONFIGURED, `Failed to get job: ${err.message}`, { cause: err.message });
                }
            },

            /**
             * List jobs with optional status/type filters
             */
            listJobs: async (options?: { status?: string; type?: string; limit?: number; cursor?: string }): Promise<{ jobs: JobStatus[]; list_complete: boolean; cursor?: string }> => {
                try {
                    return await this._rpcCall('internal', 'queue.jobs', [options || {}]) as any;
                } catch (err: any) {
                    throw new QueueError(ErrorCode.QUEUE_NOT_CONFIGURED, `Failed to list jobs: ${err.message}`, { cause: err.message });
                }
            },

            /**
             * Cancel a queued job (advisory — running jobs will be skipped on next check)
             */
            cancelJob: async (jobId: string): Promise<{ success: boolean; note?: string }> => {
                try {
                    return await this._rpcCall('internal', 'queue.cancel', [jobId]) as any;
                } catch (err: any) {
                    throw new QueueError(ErrorCode.QUEUE_NOT_CONFIGURED, `Failed to cancel job: ${err.message}`, { cause: err.message });
                }
            },
        };
    }

    /**
     * R2 Storage operations
     */
    /**
     * Resolve storage key with project isolation if configured
     */
    private resolveKey(key: string): string {
        if (this._projectId && !key.startsWith('projects/')) {
            // Ensure no leading slash
            const cleanKey = key.startsWith('/') ? key.slice(1) : key;
            return `projects/${this._projectId}/media/${cleanKey}`;
        }
        return key;
    }

    /**
     * Normalize a storage key for the RPC path:
     * - Strip leading slash
     * - Reject path traversal segments (`..`)
     * The server (AerocallHookSDK) handles project-scoping automatically.
     */
    private sanitizeStorageKey(key: string): string {
        const clean = key.startsWith('/') ? key.slice(1) : key;
        if (clean.split('/').some(seg => seg === '..')) {
            throw new StorageError(ErrorCode.STORAGE_UPLOAD_FAILED, 'Invalid storage key: path traversal not allowed', {});
        }
        return clean;
    }

    get storage() {
        return {
            /**
             * Upload file to R2 storage
             */
            upload: async (
                file: ReadableStream | ArrayBuffer | string,
                key: string,
                options?: UploadOptions
            ): Promise<UploadResult> => {
                // Direct R2 path (when developer has their own R2 binding)
                if (this._storage) {
                    try {
                        const resolvedKey = this.resolveKey(key);
                        await this._storage.put(resolvedKey, file, {
                            httpMetadata: {
                                contentType: options?.contentType,
                                cacheControl: options?.cacheControl,
                            },
                            customMetadata: options?.metadata,
                        });
                        const obj = await this._storage.get(resolvedKey);
                        const size = obj?.size || 0;
                        return {
                            key: resolvedKey,
                            url: `https://${this.env.STORAGE_PUBLIC_URL || 'storage.aerostack.ai'}/${resolvedKey}`,
                            size,
                            contentType: options?.contentType || 'application/octet-stream',
                        };
                    } catch (err: any) {
                        const resolvedKey = this.resolveKey(key);
                        throw new StorageError(
                            ErrorCode.STORAGE_UPLOAD_FAILED,
                            `Failed to upload file: ${resolvedKey}`,
                            { suggestion: 'Check R2 bucket binding and file size limits', cause: err.message },
                            { key }
                        );
                    }
                }

                // Platform storage path: call Aerostack RPC API
                try {
                    // Normalise file to a Blob so we can append to FormData
                    let blob: Blob;
                    if (typeof file === 'string') {
                        blob = new Blob([file], { type: options?.contentType || 'text/plain' });
                    } else if (file instanceof ArrayBuffer) {
                        blob = new Blob([file], { type: options?.contentType || 'application/octet-stream' });
                    } else if (ArrayBuffer.isView(file)) {
                        blob = new Blob([file.buffer as ArrayBuffer], { type: options?.contentType || 'application/octet-stream' });
                    } else {
                        // ReadableStream — consume it first
                        const reader = (file as ReadableStream<Uint8Array>).getReader();
                        const chunks: Uint8Array[] = [];
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) chunks.push(value);
                        }
                        const total = chunks.reduce((s, c) => s + c.length, 0);
                        const buf = new Uint8Array(total);
                        let off = 0;
                        for (const c of chunks) { buf.set(c, off); off += c.length; }
                        blob = new Blob([buf], { type: options?.contentType || 'application/octet-stream' });
                    }

                    // For the RPC path, pass the sanitized key — AerocallHookSDK on the server
                    // prepends projects/{projectId}/ automatically, so resolveKey() must NOT
                    // be called here or the path will be doubled.
                    const rawKey = this.sanitizeStorageKey(key);
                    const formData = new FormData();
                    formData.append('file', blob, rawKey.split('/').pop() || 'upload');
                    formData.append('key', rawKey);
                    if (options?.contentType) formData.append('contentType', options.contentType);

                    const res = await this._storageApiCall('upload', formData);
                    const data = await res.json<{ url: string }>();
                    return {
                        key: rawKey,
                        url: data.url,
                        size: blob.size,
                        contentType: options?.contentType || blob.type,
                    };
                } catch (err: any) {
                    if (err instanceof StorageError) throw err;
                    throw new StorageError(ErrorCode.STORAGE_UPLOAD_FAILED, `Failed to upload: ${key}`, { cause: err.message }, { key });
                }
            },

            /**
             * Get presigned URL for object
             */
            getUrl: async (key: string, options?: UrlOptions): Promise<string> => {
                if (this._storage) {
                    const resolvedKey = this.resolveKey(key);
                    return `https://${this.env.STORAGE_PUBLIC_URL || 'storage.aerostack.ai'}/${resolvedKey}`;
                }

                // Platform storage: sanitized key — server handles project scoping
                const res = await this._storageApiCall('getUrl', { key: this.sanitizeStorageKey(key) });
                const data = await res.json<{ url: string }>();
                return data.url;
            },

            /**
             * Delete object from storage
             */
            delete: async (key: string): Promise<void> => {
                if (this._storage) {
                    try {
                        const resolvedKey = this.resolveKey(key);
                        await this._storage.delete(resolvedKey);
                        return;
                    } catch (err: any) {
                        const resolvedKey = this.resolveKey(key);
                        throw new StorageError(
                            ErrorCode.STORAGE_DELETE_FAILED,
                            `Failed to delete file: ${resolvedKey}`,
                            { cause: err.message },
                            { key }
                        );
                    }
                }

                // Platform storage path — server handles project scoping
                await this._storageApiCall('delete', { key: this.sanitizeStorageKey(key) });
            },

            /**
             * List objects in storage
             */
            list: async (prefix?: string): Promise<StorageObject[]> => {
                if (this._storage) {
                    try {
                        const resolvedPrefix = prefix ? this.resolveKey(prefix) : (this._projectId ? `projects/${this._projectId}/media/` : undefined);
                        const listed = await this._storage.list({ prefix: resolvedPrefix });
                        return listed.objects.map((obj) => ({
                            key: obj.key,
                            size: obj.size,
                            uploaded: obj.uploaded,
                            contentType: obj.httpMetadata?.contentType,
                        }));
                    } catch (err: any) {
                        throw new StorageError(
                            ErrorCode.STORAGE_DELETE_FAILED,
                            'Failed to list storage objects',
                            { cause: err.message },
                            { prefix }
                        );
                    }
                }

                // Platform storage path — server handles project scoping
                const res = await this._storageApiCall('list', { prefix: prefix ? this.sanitizeStorageKey(prefix) : undefined });
                const data = await res.json<{ objects: StorageObject[] }>();
                return data.objects ?? [];
            },
        };
    }

    /**
     * AI operations using Cloudflare AI
     */
    get ai() {
        const self = this;
        return {
            /**
             * Generate chat completion
             */
            chat: async (messages: Message[], options?: ChatOptions): Promise<ChatResponse> => {
                if (!self._ai) {
                    // RPC fallback — platform handles the AI binding
                    const result = await self._aiApiCall('chat', {
                        model: options?.model || '@cf/meta/llama-3-8b-instruct',
                        messages,
                    });
                    return { response: result.response || '', usage: result.usage };
                }

                try {
                    const model = options?.model || '@cf/meta/llama-3-8b-instruct';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await self._ai.run(model as any, {
                        messages,
                        temperature: options?.temperature,
                        max_tokens: options?.maxTokens,
                        stream: options?.stream || false,
                    });

                    return {
                        response: (result as any).response || '',
                        usage: (result as any).usage,
                    };
                } catch (err: any) {
                    throw new AIError(
                        ErrorCode.AI_REQUEST_FAILED,
                        'AI chat request failed',
                        {
                            suggestion: 'Check model name and message format',
                            cause: err.message,
                        },
                        { messages, options }
                    );
                }
            },

            /**
             * Generate text embeddings
             */
            embed: async (text: string, options?: EmbedOptions): Promise<Embedding> => {
                if (!self._ai) {
                    // RPC fallback — platform handles the AI binding (same pattern as generate/chat)
                    const result = await self._aiApiCall('embed', {
                        text,
                        model: options?.model || '@cf/baai/bge-base-en-v1.5',
                    });
                    return { embedding: result.embedding, model: result.model };
                }

                try {
                    const model = options?.model || '@cf/baai/bge-base-en-v1.5';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await self._ai.run(model as any, { text });

                    return {
                        embedding: (result as any).data[0],
                        model,
                    };
                } catch (err: any) {
                    throw new AIError(
                        ErrorCode.AI_REQUEST_FAILED,
                        'AI embedding request failed',
                        {
                            suggestion: 'Check model name and text input',
                            cause: err.message,
                        },
                        { text, options }
                    );
                }
            },

            /**
             * Generate text from prompt
             */
            generate: async (prompt: string, options?: GenerateOptions): Promise<GenerationResult> => {
                if (!self._ai) {
                    // RPC fallback — convert prompt to chat format
                    const result = await self._aiApiCall('chat', {
                        model: options?.model || '@cf/meta/llama-3-8b-instruct',
                        messages: [{ role: 'user', content: prompt }],
                    });
                    return { text: result.response || '', usage: result.usage };
                }

                try {
                    const model = options?.model || '@cf/meta/llama-3-8b-instruct';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await self._ai.run(model as any, {
                        prompt,
                        temperature: options?.temperature,
                        max_tokens: options?.maxTokens,
                    });

                    return {
                        text: (result as any).response || '',
                        usage: (result as any).usage,
                    };
                } catch (err: any) {
                    throw new AIError(
                        ErrorCode.AI_REQUEST_FAILED,
                        'AI generation request failed',
                        {
                            suggestion: 'Check model name and prompt',
                            cause: err.message,
                        },
                        { prompt, options }
                    );
                }
            },

            /**
             * Managed Vector Search operations
             */
            get search() {
                return {
                    /**
                     * Ingest content into the managed search index.
                     * Uses direct Vectorize binding + AI embedding if both are available,
                     * otherwise routes to the Aerostack platform API which handles embedding server-side.
                     */
                    ingest: async (content: string, options: IngestOptions): Promise<void> => {
                        const { id = crypto.randomUUID(), type, metadata = {} } = options;

                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;

                        // Fast path: direct bindings — embed locally and upsert into Vectorize
                        if (vectorize && self._ai) {
                            const embedding = await self.ai.embed(content);
                            await vectorize.upsert([{
                                id,
                                values: embedding.embedding,
                                metadata: {
                                    ...metadata,
                                    type,
                                    text: content.slice(0, 1000)
                                }
                            }]);
                            return;
                        }

                        // RPC fallback — platform handles embedding + Vectorize upsert
                        await self._aiApiCall('search/ingest', { content, id, type, metadata });
                    },

                    /**
                     * Query the managed search index.
                     * Uses direct Vectorize binding + AI embedding if both are available,
                     * otherwise routes to the Aerostack platform API which handles embedding server-side.
                     */
                    query: async (text: string, options?: SearchOptions): Promise<SearchResult[]> => {
                        const topK = options?.topK || 5;

                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;

                        // Fast path: direct bindings
                        if (vectorize && self._ai) {
                            const embedding = await self.ai.embed(text);
                            const queryOptions: any = { topK, returnMetadata: true };
                            if (options?.types) {
                                queryOptions.filter = { type: { $in: options.types } };
                            }
                            if (options?.filter) {
                                queryOptions.filter = { ...queryOptions.filter, ...options.filter };
                            }

                            const results = await vectorize.query(embedding.embedding, queryOptions);
                            return results.matches.map(m => ({
                                id: m.id,
                                content: (m.metadata?.text as string) || '',
                                score: m.score,
                                type: (m.metadata?.type as string) || 'unknown',
                                metadata: m.metadata || {}
                            }));
                        }

                        // RPC fallback — platform handles embedding + Vectorize query
                        const result = await self._aiApiCall('search/query', { text, ...options });
                        return result.results || [];
                    },

                    /**
                     * Delete a search entry by ID
                     */
                    delete: async (id: string): Promise<void> => {
                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;
                        if (vectorize) {
                            await vectorize.deleteByIds([id]);
                            return;
                        }
                        await self._aiApiCall('search/delete', { id });
                    },

                    /**
                     * Delete all search entries of a given type
                     */
                    deleteByType: async (type: string): Promise<void> => {
                        await self._aiApiCall('search/deleteByType', { type });
                    },

                    /**
                     * List all content types in the search index with counts
                     */
                    listTypes: async (): Promise<TypeStats[]> => {
                        const result = await self._aiApiCall('search/listTypes', undefined, 'GET');
                        return result.types || [];
                    },

                    /**
                     * Configure search settings (embedding model, etc.)
                     */
                    configure: async (options: SearchConfigureOptions): Promise<void> => {
                        await self._aiApiCall('search/configure', options);
                    },

                    /**
                     * Update an existing search entry's content
                     */
                    update: async (id: string, content: string, options?: Partial<IngestOptions>): Promise<void> => {
                        await self._aiApiCall('search/update', {
                            id,
                            content,
                            type: options?.type,
                            metadata: options?.metadata,
                        });
                    },

                    /**
                     * Get a specific search entry by ID
                     */
                    get: async (id: string): Promise<SearchResult | null> => {
                        const result = await self._aiApiCall('search/get', { id });
                        return result.exists ? result.result : null;
                    },

                    /**
                     * Count search entries, optionally filtered by type
                     */
                    count: async (type?: string): Promise<number> => {
                        const result = await self._aiApiCall('search/count', { type });
                        return result.count ?? 0;
                    },

                    /**
                     * Pre-built pattern helpers
                     */
                    get helpers() {
                        return {
                            /**
                             * Product Recommendation helpers
                             */
                            products: {
                                ingest: async (product: Product): Promise<void> => {
                                    const { id, name, description, ...rest } = product;
                                    await self.ai.search.ingest(`${name}\n${description}`, {
                                        id,
                                        type: 'product',
                                        metadata: rest
                                    });
                                },
                                search: async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
                                    return self.ai.search.query(query, {
                                        ...options,
                                        types: ['product']
                                    });
                                }
                            },
                            /**
                             * FAQ / Knowledge base helpers
                             */
                            faq: {
                                ingest: async (faq: FAQ): Promise<void> => {
                                    const { id, question, answer, ...rest } = faq;
                                    await self.ai.search.ingest(`Q: ${question}\nA: ${answer}`, {
                                        id,
                                        type: 'faq',
                                        metadata: rest
                                    });
                                },
                                search: async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
                                    return self.ai.search.query(query, {
                                        ...options,
                                        types: ['faq']
                                    });
                                }
                            },
                            /**
                             * Content / Article helpers
                             */
                            content: {
                                ingest: async (content: SearchContent): Promise<void> => {
                                    const { id, title, body, ...rest } = content;
                                    await self.ai.search.ingest(`${title}\n${body}`, {
                                        id,
                                        type: 'content',
                                        metadata: rest
                                    });
                                },
                                search: async (query: string, options?: SearchOptions): Promise<SearchResult[]> => {
                                    return self.ai.search.query(query, {
                                        ...options,
                                        types: ['content']
                                    });
                                }
                            }
                        };
                    }
                };
            }
        };
    }

    /**
     * Realtime Socket operations
     */
    get socket() {
        return {
            emit: async (event: string, data: any, roomId?: string) => {
                // Use RPC to invoke socket emit via internal hooks API
                return this._rpcCall('internal', 'socket.emit', [event, data, roomId]);
            }
        };
    }

    /**
     * Auth operations (Server-side management via RPC)
     */
    get auth() {
        return {
            getUser: async (userId: string) => {
                return this._rpcCall('internal', 'getUser', [userId]);
            },
            getUserByEmail: async (email: string) => {
                return this._rpcCall('internal', 'getUserByEmail', [email]);
            },
            sendEmail: async (to: string, subject: string, body: string) => {
                return this._rpcCall('internal', 'sendEmail', [to, subject, body]);
            }
        };
    }

    /**
     * Service invocation via Workers Dispatch
     */
    get services() {
        return {
            /**
             * Invoke another service via RPC
             */
            invoke: async (serviceName: string, data: any, options?: InvokeOptions): Promise<any> => {
                if (!this._dispatcher) {
                    throw new ServiceError(
                        ErrorCode.SERVICE_INVOKE_FAILED,
                        'Service dispatcher not configured',
                        {
                            suggestion: 'Configure Workers Dispatch namespace in aerostack.toml or ensure API_URL/AEROSTACK_API_URL is set.',
                        }
                    );
                }

                try {
                    // Get service worker by name
                    const id = this._dispatcher.idFromName(serviceName);
                    const stub = this._dispatcher.get(id);

                    // Invoke with timeout
                    const timeout = options?.timeout || 30000;
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    const path = options?.path || '/';
                    const url = `https://internal${path.startsWith('/') ? '' : '/'}${path}`;

                    const response = await stub.fetch(
                        new Request(url, {
                            method: 'POST',
                            body: JSON.stringify(data),
                            signal: controller.signal,
                        })
                    );

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        const errText = await response.text();
                        throw new Error(`Service invocation failed (${response.status}): ${errText}`);
                    }

                    return await response.json();
                } catch (err: any) {
                    throw new ServiceError(
                        ErrorCode.SERVICE_INVOKE_FAILED,
                        `Failed to invoke service: ${serviceName}`,
                        {
                            suggestion: 'Check service name and dispatcher binding',
                            cause: err.message,
                        },
                        { serviceName, data }
                    );
                }
            },
        };
    }

    // ========== Private Helper Methods ==========

    private async routeQuery<T>(sql: string, params: any[]): Promise<DatabaseResponse<T>> {
        const target = this.determineTarget(sql);

        if (target === 'postgres' && this.pgPool) {
            try {

                const result = await this.pgPool.query(sql, params);

                return {
                    results: result.rows as T[],
                    success: true,
                    meta: { target: 'postgres', rowCount: result.rowCount || 0 },
                };
            } catch (err: any) {

                throw DatabaseError.fromPostgresError(err, { sql, params, target: 'postgres' });
            }
        }

        if (this._d1) {
            try {
                const result = await this._d1.prepare(sql).bind(...params).all();
                return {
                    results: (result.results || []) as T[],
                    success: result.success,
                    meta: { target: 'd1', duration: result.meta?.duration },
                };
            } catch (err: any) {
                throw DatabaseError.fromD1Error(err, { sql, params, target: 'd1' });
            }
        }

        // Fallback to RPC when no direct DB binding is available (dispatch namespace)
        try {
            const result = await this._rpcCall('internal', 'db.query', [sql, params]);
            return result as DatabaseResponse<T>;
        } catch (err: any) {
            throw new DatabaseError(
                ErrorCode.DB_CONNECTION_FAILED,
                `Database query failed via RPC: ${err.message}`,
                {
                    suggestion: 'Ensure the platform API is reachable and auth is configured',
                }
            );
        }
    }

    private determineTarget(sql: string): 'd1' | 'postgres' {
        const normalized = sql.toLowerCase();

        // 1. Explicit routing hints
        if (normalized.includes('aerostack:target=postgres')) return 'postgres';
        if (normalized.includes('aerostack:target=d1')) return 'd1';

        // 2. Check routing rules based on table names
        if (this.routingRules.tables) {
            for (const [table, target] of Object.entries(this.routingRules.tables)) {
                if (normalized.includes(table.toLowerCase())) {
                    return target;
                }
            }
        }

        // 3. Auto-route based on query complexity
        const complexTriggers = ['join', 'group by', 'having', 'union', 'intersect', 'except'];
        if (complexTriggers.some((trigger) => normalized.includes(trigger))) {
            return 'postgres';
        }

        // 4. Default to Postgres if available.
        // In Aerostack, Postgres (Neon) is usually the primary persistent store 
        // when present, while D1 might be used for caching or local development.
        if (this.pgPool) return 'postgres';

        // Otherwise default to D1
        return 'd1';
    }

    private async introspectD1(): Promise<SchemaInfo> {
        if (!this._d1) {
            throw new DatabaseError(ErrorCode.DB_CONNECTION_FAILED, 'D1 not configured');
        }

        // D1 blocks sqlite_master (SQLITE_AUTH). Use pragma_table_list() instead (SQLite 3.37+, supported in D1).
        // _cf_% tables are internal Cloudflare D1 system tables — exclude them.
        const result = await this._d1
            .prepare("SELECT name FROM pragma_table_list() WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
            .all();

        const tables: SchemaTable[] = [];

        for (const row of result.results as any[]) {
            const tableName = row.name;
            const columns = await this._d1.prepare(`SELECT * FROM pragma_table_info(?)`).bind(tableName).all();

            tables.push({
                name: tableName,
                columns: (columns.results as any[]).map((col) => ({
                    name: col.name,
                    type: col.type,
                    nullable: col.notnull === 0,
                    defaultValue: col.dflt_value,
                    isPrimaryKey: col.pk === 1,
                })),
                database: 'd1',
            });
        }

        return { tables, database: 'd1' };
    }

    private async introspectPostgres(): Promise<SchemaInfo> {
        if (!this.pgPool) {
            throw new DatabaseError(ErrorCode.DB_CONNECTION_FAILED, 'Postgres not configured');
        }

        const result = await this.pgPool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);

        const tables: SchemaTable[] = [];

        for (const row of result.rows) {
            const tableName = row.table_name;
            const columns = await this.pgPool.query(
                `
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_name = $1
            `,
                [tableName]
            );

            tables.push({
                name: tableName,
                columns: columns.rows.map((col: any) => ({
                    name: col.column_name,
                    type: col.data_type,
                    nullable: col.is_nullable === 'YES',
                    defaultValue: col.column_default,
                })),
                database: 'postgres',
            });
        }

        return { tables, database: 'postgres' };
    }

    private findPostgresConnStr(env: Record<string, any>): string | undefined {

        // 1. Look for DATABASE_URL or anything ending in _DATABASE_URL
        const entry = Object.entries(env).find(([key]) =>
            key === 'DATABASE_URL' || key.endsWith('_DATABASE_URL')
        );
        if (entry) return entry[1];

        // 2. Fallback: Check for Hyperdrive local connection strings (injected by Aerostack CLI)
        const hyperdriveEntry = Object.entries(env).find(([key]) =>
            key.startsWith('CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_')
        );
        if (hyperdriveEntry) return hyperdriveEntry[1] as string;

        // 3. Hyperdrive binding (e.g. env.PG from wrangler): use .connectionString when present
        const pgBinding = env?.PG;
        if (pgBinding && typeof pgBinding === 'object' && typeof (pgBinding as any).connectionString === 'string') {
            return (pgBinding as any).connectionString;
        }
        return undefined;
    }
}

// Re-export types and errors for convenience
export * from './server-types';
export * from './server-errors';

// Keep legacy exports for backwards compatibility
export type { DatabaseResponse, RoutingRules };
