/**
 * Type definitions for Aerostack Server SDK
 */

// ============ Database Types ============

export interface DatabaseResponse<T = any> {
    results: T[];
    success: boolean;
    meta: {
        target: 'd1' | 'postgres';
        rowCount?: number;
        duration?: number;
    };
}

export interface RoutingRules {
    tables: Record<string, 'd1' | 'postgres'>;
}

export interface AerostackOptions {
    routing?: RoutingRules;
    storage?: R2Bucket;
    storageBinding?: string;
    projectId?: string;
    authToken?: string;
    hookId?: string;
}

export interface SchemaColumn {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue?: any;
    isPrimaryKey?: boolean;
}

export interface SchemaTable {
    name: string;
    columns: SchemaColumn[];
    database: 'd1' | 'postgres';
}

export interface SchemaInfo {
    tables: SchemaTable[];
    database: 'd1' | 'postgres';
}

export interface Transaction {
    query<T = any>(sql: string, params?: any[]): Promise<DatabaseResponse<T>>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export interface BatchQuery {
    sql: string;
    params?: any[];
}

export interface BatchResult {
    results: DatabaseResponse[];
    success: boolean;
    errors?: Array<{ index: number; error: Error }>;
}

// ============ Cache Types ============

export interface CacheOptions {
    ttl?: number; // Time to live in seconds
    expirationTtl?: number; // Alias for ttl
}

export interface CacheGetOptions {
    type?: 'text' | 'json' | 'arrayBuffer' | 'stream';
}

// ============ Queue Types ============

export interface Job {
    type: string;
    data: any;
    delay?: number; // Delay in seconds
    retries?: number;
}

export interface JobResult {
    jobId: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    queuedAt: Date;
}

export interface JobStatus {
    id: string;
    type: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    attempts: number;
    createdAt: Date;
    completedAt?: Date;
    error?: string;
}

// ============ Storage Types ============

export interface UploadOptions {
    contentType?: string;
    metadata?: Record<string, string>;
    cacheControl?: string;
}

export interface UploadResult {
    key: string;
    url: string;
    size: number;
    contentType: string;
}

export interface UrlOptions {
    expiresIn?: number; // Seconds
    download?: boolean;
}

export interface StorageObject {
    key: string;
    size: number;
    uploaded: Date;
    contentType?: string;
}

// ============ AI Types ============

export interface Message {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
}

export interface ChatResponse {
    response: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}

export interface EmbedOptions {
    model?: string;
}

export interface Embedding {
    embedding: number[];
    model: string;
}

export interface GenerateOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface GenerationResult {
    text: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

// ============ Search Types ============

export interface SearchOptions {
    topK?: number;
    types?: string[];
    filter?: Record<string, any>;
}

export interface IngestOptions {
    id?: string;
    type: string;
    metadata?: Record<string, any>;
}

export interface SearchResult {
    id: string;
    content: string;
    score: number;
    type: string;
    metadata: Record<string, any>;
}

export interface Product {
    id?: string;
    name: string;
    description: string;
    price?: number;
    category?: string;
    image?: string;
    url?: string;
    metadata?: Record<string, any>;
}

export interface FAQ {
    id?: string;
    question: string;
    answer: string;
    category?: string;
    tags?: string[];
    metadata?: Record<string, any>;
}

export interface SearchContent {
    id?: string;
    title: string;
    body: string;
    url?: string;
    author?: string;
    publishedAt?: string;
    metadata?: Record<string, any>;
}

export interface TypeStats {
    type: string;
    count: number;
}

export interface SearchConfigureOptions {
    model: 'english' | 'multilingual';
}

// ============ Service Types ============

export interface InvokeOptions {
    timeout?: number; // Milliseconds
    path?: string;
}

export interface AuthContext {
    user?: any;
    request: Request;
}

export interface AuthHookResult {
    allow: boolean;
    user?: any;
    error?: string;
}

// ============ Environment Types ============

export interface AerostackEnv {
    DB?: D1Database;
    DB_ECOMMERCE?: D1Database;
    CACHE?: KVNamespace;
    QUEUE?: Queue;
    MEDIA?: R2Bucket;
    AI?: Ai;
    DISPATCHER?: DurableObjectNamespace;
    API?: Fetcher;
    API_URL?: string;
    [key: string]: any;
}
