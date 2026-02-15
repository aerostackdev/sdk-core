import { Pool } from '@neondatabase/serverless';
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
    GenerateOptions,
    GenerationResult,
    InvokeOptions,
    AuthContext,
    AuthHookResult,
    AerostackEnv,
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
    private routingRules: RoutingRules;
    private env: AerostackEnv;

    constructor(env: AerostackEnv, options: { routing?: RoutingRules } = {}) {
        this.env = env;
        this._d1 = env.DB;
        this._kv = env.CACHE;
        this._queue = env.QUEUE;
        this._storage = env.STORAGE;
        this._ai = env.AI;
        this._dispatcher = env.DISPATCHER;
        this.routingRules = options.routing || { tables: {} };

        // Look for Postgres connection string in environment
        const pgConnStr = this.findPostgresConnStr(env);
        if (pgConnStr) {
            this.pgPool = new Pool({ connectionString: pgConnStr });
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
                return this.routeQuery<T>(sql, params);
            },

            /**
             * Get database schema information
             */
            getSchema: async (binding?: string): Promise<SchemaInfo> => {
                // If binding specified, get schema for that specific database
                if (binding) {
                    if (this.pgPool && binding.toLowerCase().includes('postgres')) {
                        return this.introspectPostgres();
                    }
                    if (this._d1) {
                        return this.introspectD1();
                    }
                }

                // Default: get D1 schema if available
                if (this._d1) {
                    return this.introspectD1();
                }

                // Otherwise Postgres
                if (this.pgPool) {
                    return this.introspectPostgres();
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
                    throw new CacheError(
                        ErrorCode.CACHE_NOT_CONFIGURED,
                        'KV cache not configured',
                        {
                            suggestion: 'Add [[kv_namespaces]] binding to aerostack.toml',
                        }
                    );
                }

                try {
                    const type = options?.type || 'json';
                    // Type assertion needed for KV get with different types
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
                    throw new CacheError(
                        ErrorCode.CACHE_NOT_CONFIGURED,
                        'KV cache not configured',
                        {
                            suggestion: 'Add [[kv_namespaces]] binding to aerostack.toml',
                        }
                    );
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
                    throw new CacheError(
                        ErrorCode.CACHE_NOT_CONFIGURED,
                        'KV cache not configured',
                        {
                            suggestion: 'Add [[kv_namespaces]] binding to aerostack.toml',
                        }
                    );
                }

                try {
                    await this._kv.delete(key);
                } catch (err: any) {
                    throw new CacheError(
                        ErrorCode.CACHE_DELETE_FAILED,
                        `Failed to delete cache key: ${key}`,
                        {
                            cause: err.message,
                        },
                        { key }
                    );
                }
            },

            /**
             * Check if key exists in cache
             */
            exists: async (key: string): Promise<boolean> => {
                if (!this._kv) {
                    return false;
                }

                try {
                    const value = await this._kv.get(key);
                    return value !== null;
                } catch {
                    return false;
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
                    throw new QueueError(
                        ErrorCode.QUEUE_NOT_CONFIGURED,
                        'Queue not configured',
                        {
                            suggestion: 'Add [[queues]] binding to aerostack.toml',
                        }
                    );
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

                    // Generate job ID (in production, use queue message ID)
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
        };
    }

    /**
     * R2 Storage operations
     */
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
                if (!this._storage) {
                    throw new StorageError(
                        ErrorCode.STORAGE_NOT_CONFIGURED,
                        'R2 storage not configured',
                        {
                            suggestion: 'Add [[r2_buckets]] binding to aerostack.toml',
                        }
                    );
                }

                try {
                    await this._storage.put(key, file, {
                        httpMetadata: {
                            contentType: options?.contentType,
                            cacheControl: options?.cacheControl,
                        },
                        customMetadata: options?.metadata,
                    });

                    // Get object to return size
                    const obj = await this._storage.get(key);
                    const size = obj?.size || 0;

                    return {
                        key,
                        url: `https://${this.env.STORAGE_PUBLIC_URL || 'storage.aerostack.ai'}/${key}`,
                        size,
                        contentType: options?.contentType || 'application/octet-stream',
                    };
                } catch (err: any) {
                    throw new StorageError(
                        ErrorCode.STORAGE_UPLOAD_FAILED,
                        `Failed to upload file: ${key}`,
                        {
                            suggestion: 'Check R2 bucket binding and file size limits',
                            cause: err.message,
                        },
                        { key }
                    );
                }
            },

            /**
             * Get presigned URL for object
             */
            getUrl: async (key: string, options?: UrlOptions): Promise<string> => {
                if (!this._storage) {
                    throw new StorageError(
                        ErrorCode.STORAGE_NOT_CONFIGURED,
                        'R2 storage not configured',
                        {
                            suggestion: 'Add [[r2_buckets]] binding to aerostack.toml',
                        }
                    );
                }

                // For public buckets, return direct URL
                return `https://${this.env.STORAGE_PUBLIC_URL || 'storage.aerostack.ai'}/${key}`;
            },

            /**
             * Delete object from storage
             */
            delete: async (key: string): Promise<void> => {
                if (!this._storage) {
                    throw new StorageError(
                        ErrorCode.STORAGE_NOT_CONFIGURED,
                        'R2 storage not configured',
                        {
                            suggestion: 'Add [[r2_buckets]] binding to aerostack.toml',
                        }
                    );
                }

                try {
                    await this._storage.delete(key);
                } catch (err: any) {
                    throw new StorageError(
                        ErrorCode.STORAGE_DELETE_FAILED,
                        `Failed to delete file: ${key}`,
                        {
                            cause: err.message,
                        },
                        { key }
                    );
                }
            },

            /**
             * List objects in storage
             */
            list: async (prefix?: string): Promise<StorageObject[]> => {
                if (!this._storage) {
                    throw new StorageError(
                        ErrorCode.STORAGE_NOT_CONFIGURED,
                        'R2 storage not configured',
                        {
                            suggestion: 'Add [[r2_buckets]] binding to aerostack.toml',
                        }
                    );
                }

                try {
                    const listed = await this._storage.list({ prefix });
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
                        {
                            cause: err.message,
                        },
                        { prefix }
                    );
                }
            },
        };
    }

    /**
     * AI operations using Cloudflare AI
     */
    get ai() {
        return {
            /**
             * Generate chat completion
             */
            chat: async (messages: Message[], options?: ChatOptions): Promise<ChatResponse> => {
                if (!this._ai) {
                    throw new AIError(
                        ErrorCode.AI_NOT_CONFIGURED,
                        'AI binding not configured',
                        {
                            suggestion: 'AI binding is automatically available in Workers',
                        }
                    );
                }

                try {
                    const model = options?.model || '@cf/meta/llama-3-8b-instruct';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await this._ai.run(model as any, {
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
                if (!this._ai) {
                    throw new AIError(
                        ErrorCode.AI_NOT_CONFIGURED,
                        'AI binding not configured',
                        {
                            suggestion: 'AI binding is automatically available in Workers',
                        }
                    );
                }

                try {
                    const model = options?.model || '@cf/baai/bge-base-en-v1.5';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await this._ai.run(model as any, { text });

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
                if (!this._ai) {
                    throw new AIError(
                        ErrorCode.AI_NOT_CONFIGURED,
                        'AI binding not configured',
                        {
                            suggestion: 'AI binding is automatically available in Workers',
                        }
                    );
                }

                try {
                    const model = options?.model || '@cf/meta/llama-3-8b-instruct';
                    // @ts-ignore - Workers AI types are complex
                    const result: any = await this._ai.run(model as any, {
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
                            suggestion: 'Configure Workers Dispatch namespace in aerostack.toml',
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

                    const response = await stub.fetch(
                        new Request('https://internal/', {
                            method: 'POST',
                            body: JSON.stringify(data),
                            signal: controller.signal,
                        })
                    );

                    clearTimeout(timeoutId);

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

        throw new DatabaseError(
            ErrorCode.DB_CONNECTION_FAILED,
            'No database connection available',
            {
                suggestion: 'Configure DB or Postgres connection in aerostack.toml',
            }
        );
    }

    private determineTarget(sql: string): 'd1' | 'postgres' {
        const normalized = sql.toLowerCase();

        // 1. Explicit routing hints
        if (normalized.includes('aerostack:target=postgres')) return 'postgres';
        if (normalized.includes('aerostack:target=d1')) return 'd1';

        // 2. Check routing rules based on table names
        for (const [table, target] of Object.entries(this.routingRules.tables)) {
            if (normalized.includes(table.toLowerCase())) {
                return target;
            }
        }

        // 3. Auto-route based on query complexity
        const complexTriggers = ['join', 'group by', 'having', 'union', 'intersect', 'except'];
        if (complexTriggers.some((trigger) => normalized.includes(trigger))) {
            return 'postgres';
        }

        // Default to D1 for edge performance
        return 'd1';
    }

    private async introspectD1(): Promise<SchemaInfo> {
        if (!this._d1) {
            throw new DatabaseError(ErrorCode.DB_CONNECTION_FAILED, 'D1 not configured');
        }

        const result = await this._d1
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            .all();

        const tables: SchemaTable[] = [];

        for (const row of result.results as any[]) {
            const tableName = row.name;
            const columns = await this._d1.prepare(`PRAGMA table_info(${tableName})`).all();

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
        const entry = Object.entries(env).find(([key]) => key.endsWith('_DATABASE_URL'));
        return entry ? entry[1] : undefined;
    }
}

// Re-export types and errors for convenience
export * from './server-types';
export * from './server-errors';

// Keep legacy exports for backwards compatibility
export type { DatabaseResponse, RoutingRules };
