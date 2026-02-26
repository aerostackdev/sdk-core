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
import { EcommerceService } from './ecommerce';
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
        this._projectId = options.projectId || env.AEROSTACK_PROJECT_ID;
        this._authToken = options.authToken || env.AEROSTACK_API_KEY;
        this._hookId = options.hookId || '';

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

        // Project ID for storage isolation
        this._projectId = options.projectId || env.AEROSTACK_PROJECT_ID;

        // Async init for dynamic dependencies
        this._initPromise = this.initPostgres(env);
    }

    private async _rpcCall(serviceName: string, method: string, args: any[]) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this._authToken) {
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
                throw new Error(`RPC ${method} failed via Service Binding (${res.status}): ${errText}`);
            }
            return res.json();
        }

        // 2. Try HTTP URL if available
        const apiUrl = this.env.API_URL || this.env.AEROSTACK_API_URL;
        if (serviceName === 'internal' && apiUrl) {
            const res = await fetch(`${apiUrl}/internal/hooks/rpc`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ method, args, projectId: this._projectId ?? undefined })
            });
            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`RPC ${method} failed via HTTP (${res.status}): ${errText}`);
            }
            return res.json();
        }

        // 3. Fallback to dispatcher (original logic)
        return this.services.invoke(serviceName, { method, args }, { path: '/internal/hooks/rpc' });
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
                    // Fallback to RPC for managed environments without direct queue binding
                    try {
                        await this._rpcCall('internal', 'queue.enqueue', [job.type, job.data]);
                        return {
                            jobId: `rpc_${Date.now()}`,
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
                    const resolvedKey = this.resolveKey(key);
                    await this._storage.put(resolvedKey, file, {
                        httpMetadata: {
                            contentType: options?.contentType,
                            cacheControl: options?.cacheControl,
                        },
                        customMetadata: options?.metadata,
                    });

                    // Get object to return size
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

                const resolvedKey = this.resolveKey(key);

                // For public buckets, return direct URL
                return `https://${this.env.STORAGE_PUBLIC_URL || 'storage.aerostack.ai'}/${resolvedKey}`;
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
                    const resolvedKey = this.resolveKey(key);
                    await this._storage.delete(resolvedKey);
                } catch (err: any) {
                    const resolvedKey = this.resolveKey(key);
                    throw new StorageError(
                        ErrorCode.STORAGE_DELETE_FAILED,
                        `Failed to delete file: ${resolvedKey}`,
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
        const self = this;
        return {
            /**
             * Generate chat completion
             */
            chat: async (messages: Message[], options?: ChatOptions): Promise<ChatResponse> => {
                if (!self._ai) {
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
                     * Ingest content into managed search index
                     */
                    ingest: async (content: string, options: IngestOptions): Promise<void> => {
                        const { id = crypto.randomUUID(), type, metadata = {} } = options;

                        // 1. Get embedding
                        const embedding = await self.ai.embed(content);

                        // 2. Storage and Vectorize update via internal API or direct bindings
                        // For standalone SDK, we assume user might handle storage or we provide a default managed path
                        // However, to keep it "managed", we should ideally route this to Aerostack API 
                        // IF the SDK is initialized with an apiKey.

                        // IF we have direct bindings, we can do it directly
                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;
                        if (vectorize) {
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

                        // Fallback: Use service invocation if available
                        await self._rpcCall('internal', 'ai.search.ingest', [{ content, options }]);
                    },

                    /**
                     * Search managed index
                     */
                    query: async (text: string, options?: SearchOptions): Promise<SearchResult[]> => {
                        const topK = options?.topK || 5;

                        // 1. Get embedding
                        const embedding = await self.ai.embed(text);

                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;
                        if (vectorize) {
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

                        return self._rpcCall('internal', 'ai.search.query', [{ text, options }]);
                    },

                    /**
                     * Delete item by ID
                     */
                    delete: async (id: string): Promise<void> => {
                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;
                        if (vectorize) {
                            await vectorize.deleteByIds([id]);
                            return;
                        }
                        await self._rpcCall('internal', 'ai.search.delete', [{ id }]);
                    },

                    /**
                     * Delete all items of a certain type
                     */
                    deleteByType: async (type: string): Promise<void> => {
                        // Vectorize doesn't support delete by filter directly in all versions, 
                        // so we might need to route this to the API which has a DB backup
                        await self._rpcCall('internal', 'ai.search.deleteByType', [{ type }]);
                    },

                    /**
                     * List all types
                     */
                    listTypes: async (): Promise<TypeStats[]> => {
                        const vectorize = (self.env as any).VECTORIZE as VectorizeIndex;
                        // RPC fallback
                        return self._rpcCall('internal', 'ai.search.listTypes', []);
                    },

                    /**
                     * Configure search settings
                     */
                    configure: async (options: SearchConfigureOptions): Promise<void> => {
                        await self.services.invoke('internal.ai.search.configure', options);
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
     * Ecommerce operations
     */
    get ecommerce() {
        if (!this._projectId) {
            throw new Error('Project ID required for ecommerce operations. Pass projectId in sdk.init() options.');
        }
        const service = new EcommerceService(this.env, this._projectId);
        return {
            products: {
                list: (options: any) => service.listProducts(options),
                get: (id: string) => service.getProduct(id)
            },
            orders: {
                list: (options: any) => service.listOrders(options),
                get: (id: string) => service.getOrder(id),
                create: (data: any) => service.createOrder(data)
            },
            customers: {
                list: (options: any) => service.listCustomers(options),
                get: (id: string) => service.getCustomer(id)
            },
            analytics: {
                getStats: (period?: string) => service.getStats(period)
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
        // 1. Look for DATABASE_URL or anything ending in _DATABASE_URL
        const entry = Object.entries(env).find(([key]) =>
            key === 'DATABASE_URL' || key.endsWith('_DATABASE_URL')
        );
        if (entry) return entry[1];

        // 2. Fallback: Check for Hyperdrive local connection strings (injected by Aerostack CLI)
        const hyperdriveEntry = Object.entries(env).find(([key]) =>
            key.startsWith('CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_')
        );
        return hyperdriveEntry ? hyperdriveEntry[1] : undefined;
    }
}

// Re-export types and errors for convenience
export * from './server-types';
export * from './server-errors';

// Keep legacy exports for backwards compatibility
export type { DatabaseResponse, RoutingRules };
