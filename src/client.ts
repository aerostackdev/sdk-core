import { ClientError, ClientErrorCode, AuthenticationError, ValidationError, NetworkError } from './client-errors';
import { RealtimeClient, RealtimeEvent, RealtimeCallback } from './realtime';
import { DEFAULT_API_URL } from './config';

export interface SDKConfig {
    projectSlug: string;
    projectId?: string;
    baseUrl?: string;
    apiKey?: string;
}

/**
 * Placeholder for generated project types.
 * Use `aerostack generate types` to populate this.
 */
export interface DefaultProjectSchema {
    collections: Record<string, any>;
    customApis: Record<string, { params: any; response: any }>;
    queues: Record<string, any>;
    cache: Record<string, any>;
}

export interface AuthResponse {
    success: boolean;
    user?: User;
    token?: string;
    refreshToken?: string;
    expiresAt?: string;
    error?: string;
    requiresVerification?: boolean;
}

export interface User {
    id: string;
    email: string;
    name?: string;
    emailVerified: boolean;
    createdAt: string;
    customFields?: Record<string, any>;
}

export interface RegisterData {
    email: string;
    password: string;
    name?: string;
    customFields?: Record<string, any>;
    turnstileToken?: string;
}

export interface OTPResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface VerifyResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface ResetResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export interface LogoutResponse {
    success: boolean;
}

export interface ProfileUpdate {
    name?: string;
    avatar_url?: string;
    avatar_image_id?: string;
    customFields?: Record<string, any>;
}

export interface OTPSendResponse {
    success: boolean;
    message?: string;
    accountExists?: boolean;
    error?: string;
}

/**
 * Aerostack Client SDK
 * 
 * Provides client-side authentication, database access, and 
 * custom logic invocation with full type-safety.
 */
export interface GatewayUsageSummary {
    total_tokens: number;
    total_requests: number;
    days: number;
}

export interface GatewayWallet {
    balance: number;
    total_purchased: number;
    total_consumed: number;
    plan_type: string;
    hard_limit: number | null;
    soft_limit: number | null;
}

export class AerostackClient<T extends DefaultProjectSchema = DefaultProjectSchema> {
    private projectSlug: string;
    private projectId?: string;
    private baseUrl: string;
    private apiKey?: string;
    private _realtime: RealtimeClient | null = null;
    private _token?: string;
    private _userId?: string;
    private _consumerKey?: string;

    constructor(config: SDKConfig) {
        this.projectSlug = config.projectSlug;
        this.projectId = config.projectId;
        this.baseUrl = config.baseUrl || DEFAULT_API_URL;
        this.apiKey = config.apiKey;
    }

    /**
     * Authentication operations
     */
    /**
     * Base URL for public auth endpoints: /api/v1/public/projects/:projectSlug/auth
     * Derives from baseUrl by stripping the /v1 suffix and using the full API path.
     */
    private get _authBase(): string {
        // e.g. https://api.aerostack.dev/v1 → https://api.aerostack.dev/api/v1/public/projects/slug
        const host = this.baseUrl.replace(/\/v1\/?$/, '');
        return `${host}/api/v1/public/projects/${this.projectSlug}/auth`;
    }

    private async _authRequest(path: string, method: string, body?: any, token?: string): Promise<any> {
        const url = `${this._authBase}${path}`;
        const requestId = crypto.randomUUID();

        const fetchOptions: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-request-id': requestId,
                ...(token && { Authorization: `Bearer ${token}` }),
            },
        };
        if (body && method !== 'GET') {
            fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        const data: any = await response.json();

        if (!response.ok) {
            const errorCode = this.mapErrorCode(data.code, response.status);
            // Surface Zod validation field errors in the message so developers see what failed
            let message = data.message || data.error || 'Auth request failed';
            if (data.details?.fieldErrors) {
                const fieldSummary = Object.entries(data.details.fieldErrors as Record<string, string[]>)
                    .map(([field, errors]) => `${field}: ${errors.join(', ')}`)
                    .join('; ');
                if (fieldSummary) message = `${message} — ${fieldSummary}`;
            }
            throw new ClientError(
                errorCode,
                message,
                { suggestion: this.getSuggestion(errorCode, data), field: data.field, details: data.details?.fieldErrors ? { fieldErrors: data.details.fieldErrors } : undefined },
                response.status
            );
        }
        return data;
    }

    get auth() {
        return {
            /**
             * Register a new user
             */
            register: async (data: RegisterData): Promise<AuthResponse> => {
                if (!data.email || !data.email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email', 'Provide a valid email address');
                }
                if (!data.password || data.password.length < 8) {
                    throw new ValidationError('Password must be at least 8 characters', 'password', 'Use a password with at least 8 characters, one uppercase letter, one lowercase letter, and one number');
                }
                if (!/[A-Z]/.test(data.password)) {
                    throw new ValidationError('Password must contain at least one uppercase letter', 'password', 'Add an uppercase letter (A-Z) to your password');
                }
                if (!/[a-z]/.test(data.password)) {
                    throw new ValidationError('Password must contain at least one lowercase letter', 'password', 'Add a lowercase letter (a-z) to your password');
                }
                if (!/[0-9]/.test(data.password)) {
                    throw new ValidationError('Password must contain at least one number', 'password', 'Add a number (0-9) to your password');
                }
                return this._authRequest('/register', 'POST', {
                    email: data.email,
                    password: data.password,
                    name: data.name,
                    customFields: data.customFields,
                    ...(data.turnstileToken && { turnstileToken: data.turnstileToken }),
                });
            },

            /**
             * Login with email and password
             */
            login: async (email: string, password: string, turnstileToken?: string): Promise<AuthResponse> => {
                if (!email || !password) {
                    throw new ValidationError('Email and password are required', 'email');
                }
                return this._authRequest('/login', 'POST', { email, password, ...(turnstileToken && { turnstileToken }) });
            },

            /**
             * Send OTP code to email or phone
             */
            sendOTP: async (identifier: string, type: 'email' | 'phone' = 'email'): Promise<OTPSendResponse> => {
                if (!identifier) {
                    throw new ValidationError('Email or phone is required', 'identifier');
                }
                const body = type === 'phone' ? { phone: identifier } : { email: identifier };
                return this._authRequest('/otp/send', 'POST', body);
            },

            /**
             * Verify OTP code and login
             */
            verifyOTP: async (identifier: string, code: string, type: 'email' | 'phone' = 'email'): Promise<AuthResponse> => {
                if (!identifier || !code) {
                    throw new ValidationError('Identifier and code are required');
                }
                if (code.length !== 6 || !/^\d+$/.test(code)) {
                    throw new ValidationError('OTP code must be 6 digits', 'code');
                }
                const body = type === 'phone' ? { phone: identifier, code } : { email: identifier, code };
                return this._authRequest('/otp/verify', 'POST', body);
            },

            /**
             * Verify email with token from the verification email
             */
            verifyEmail: async (token: string): Promise<VerifyResponse> => {
                if (!token) {
                    throw new ValidationError('Verification token is required', 'token');
                }
                return this._authRequest(`/verify-email?token=${encodeURIComponent(token)}`, 'GET');
            },

            /**
             * Resend email verification link
             */
            resendVerificationEmail: async (email: string): Promise<VerifyResponse> => {
                if (!email || !email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email');
                }
                return this._authRequest('/resend-verification', 'POST', { email });
            },

            /**
             * Request password reset email
             */
            requestPasswordReset: async (email: string, turnstileToken?: string): Promise<ResetResponse> => {
                if (!email || !email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email');
                }
                return this._authRequest('/reset-password-request', 'POST', { email, ...(turnstileToken && { turnstileToken }) });
            },

            /**
             * Reset password using token from the reset email
             */
            resetPassword: async (token: string, newPassword: string): Promise<ResetResponse> => {
                if (!token) {
                    throw new ValidationError('Reset token is required', 'token');
                }
                if (!newPassword || newPassword.length < 8) {
                    throw new ValidationError('Password must be at least 8 characters', 'password', 'Use a password with at least 8 characters, one uppercase letter, one lowercase letter, and one number');
                }
                if (!/[A-Z]/.test(newPassword)) {
                    throw new ValidationError('Password must contain at least one uppercase letter', 'password', 'Add an uppercase letter (A-Z) to your password');
                }
                if (!/[a-z]/.test(newPassword)) {
                    throw new ValidationError('Password must contain at least one lowercase letter', 'password', 'Add a lowercase letter (a-z) to your password');
                }
                if (!/[0-9]/.test(newPassword)) {
                    throw new ValidationError('Password must contain at least one number', 'password', 'Add a number (0-9) to your password');
                }
                return this._authRequest('/reset-password', 'POST', { token, newPassword });
            },

            /**
             * Refresh access token using a refresh token
             */
            refreshToken: async (refreshToken: string): Promise<AuthResponse> => {
                if (!refreshToken) {
                    throw new ValidationError('Refresh token is required', 'refreshToken');
                }
                return this._authRequest('/refresh', 'POST', { refreshToken });
            },

            /**
             * Logout and invalidate tokens
             */
            logout: async (token: string, refreshToken?: string): Promise<LogoutResponse> => {
                return this._authRequest('/logout', 'POST', { ...(refreshToken && { refreshToken }), accessToken: token }, token);
            },

            /**
             * Get current user profile
             */
            getCurrentUser: async (token: string): Promise<User> => {
                if (!token) {
                    throw new AuthenticationError(ClientErrorCode.AUTH_TOKEN_INVALID, 'Authentication token is required', { suggestion: 'Please login first' });
                }
                const response = await this._authRequest('/me', 'GET', undefined, token);
                return response.user ?? response;
            },

            /**
             * Update user profile (name, avatar, custom fields)
             */
            updateProfile: async (token: string, updates: ProfileUpdate): Promise<User> => {
                if (!token) {
                    throw new AuthenticationError(ClientErrorCode.AUTH_TOKEN_INVALID, 'Authentication token is required', { suggestion: 'Please login first' });
                }
                const response = await this._authRequest('/me', 'PATCH', updates, token);
                this._token = token;
                if (response.user?.id) this._userId = response.user.id;
                return response.user ?? response;
            },

            /**
             * Delete user avatar
             */
            deleteAvatar: async (token: string): Promise<{ message: string }> => {
                if (!token) {
                    throw new AuthenticationError(ClientErrorCode.AUTH_TOKEN_INVALID, 'Authentication token is required', { suggestion: 'Please login first' });
                }
                return this._authRequest('/me/avatar', 'DELETE', undefined, token);
            },
        };
    }

    /**
     * Set authentication context for the client
     */
    setAuth(token: string, userId: string) {
        this._token = token;
        this._userId = userId;
    }

    /**
     * Realtime operations
     * Uses projectId when available (required for correct topic routing); falls back to projectSlug.
     */
    get realtime() {
        if (!this._realtime) {
            this._realtime = new RealtimeClient({
                baseUrl: this.baseUrl,
                projectId: this.projectId ?? this.projectSlug,
                token: this._token,
                userId: this._userId,
                apiKey: this.apiKey
            });
        }
        return this._realtime;
    }

    /**
     * Stream an SSE response from any LLM endpoint with token-by-token callbacks.
     *
     * Pass the Fetch Response from an Aerostack gateway call (or any OpenAI-compatible
     * endpoint), and Aerostack processes the SSE stream with billing-aware metering.
     *
     * ```typescript
     * import { Aerostack } from '@aerostack/sdk';
     * const ai = new Aerostack({ projectSlug: 'my-ai-product' });
     * ai.gateway.setConsumerKey('ask_live_...');
     *
     * const response = await fetch('.../v1/chat/completions', { ... });
     * await ai.stream(response, {
     *   userId: 'user_123',
     *   model: 'gpt-4o',
     *   onToken: (delta) => process.stdout.write(delta),
     * });
     * ```
     */
    async stream(
        response: Response,
        opts: {
            userId?: string;
            model?: string;
            onToken?: (delta: string) => void;
            onDone?: (result: { text: string; tokensUsed: number }) => void;
            onError?: (error: Error) => void;
        } = {}
    ): Promise<{ text: string; tokensUsed: number }> {
        if (!response.ok || !response.body) {
            const errData = await response.json().catch(() => ({ error: 'Request failed' })) as any;
            const error = new Error(errData.error || `HTTP ${response.status}`);
            opts.onError?.(error);
            throw error;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = '';
        let totalTokens = 0;
        let estimatedTokens = 0;
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6).trim();
                    if (payload === '[DONE]') {
                        reader.cancel();
                        const result = { text, tokensUsed: totalTokens || estimatedTokens };
                        opts.onDone?.(result);
                        return result;
                    }
                    try {
                        const parsed = JSON.parse(payload);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            text += delta;
                            estimatedTokens += Math.ceil(delta.length / 4);
                            opts.onToken?.(delta);
                        }
                        if (parsed.usage?.total_tokens) totalTokens = parsed.usage.total_tokens;
                        else if (parsed.usage?.completion_tokens) totalTokens = parsed.usage.completion_tokens;
                    } catch {
                        // Skip malformed SSE frames
                    }
                }
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                const error = err instanceof Error ? err : new Error(String(err));
                opts.onError?.(error);
                throw error;
            }
        }

        const result = { text, tokensUsed: totalTokens || estimatedTokens };
        opts.onDone?.(result);
        return result;
    }

    /**
     * Create a slug-bound gateway API client for simpler chat interactions.
     *
     * ```typescript
     * const gw = client.chatApi('my-chatbot');
     *
     * // Non-streaming
     * const { content } = await gw.chat({ message: 'Hello' });
     *
     * // Streaming
     * await gw.chat({
     *   message: 'Tell me a story',
     *   stream: true,
     *   onToken: (delta) => process.stdout.write(delta),
     * });
     *
     * // With history
     * await gw.chat({
     *   message: 'Follow up question',
     *   history: [
     *     { role: 'user', content: 'Hello' },
     *     { role: 'assistant', content: 'Hi there!' },
     *   ],
     * });
     * ```
     */
    chatApi(apiSlug: string): AerostackGatewayApi {
        return new AerostackGatewayApi(this, apiSlug);
    }

    /**
     * AI Gateway operations
     *
     * Provides consumer-facing access to gateway-proxied AI APIs:
     * - Non-streaming and streaming chat completions
     * - WebSocket connections
     * - Usage and wallet queries
     */
    get gateway() {
        const self = this;
        const host = this.baseUrl.replace(/\/v1\/?$/, '');

        return {
            /**
             * Set the consumer API key for gateway requests.
             * Format: ask_live_XXXX or ask_test_XXXX
             */
            setConsumerKey(key: string) {
                self._consumerKey = key;
            },

            /**
             * Non-streaming chat completion via the gateway.
             */
            complete: async (opts: {
                apiSlug: string;
                messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
                model?: string;
            }): Promise<{ content: string; tokensUsed: number }> => {
                const url = `${host}/api/gateway/${opts.apiSlug}/v1/chat/completions`;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this._consumerKey) headers['Authorization'] = `Bearer ${this._consumerKey}`;
                else if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
                if (this.apiKey) headers['X-Aerostack-Key'] = this.apiKey;

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        messages: opts.messages,
                        stream: false,
                        ...(opts.model ? { model: opts.model } : {}),
                    }),
                });

                if (!response.ok) {
                    const err: any = await response.json().catch(() => ({}));
                    throw new ClientError(
                        this.mapErrorCode(err.code, response.status),
                        err.error || err.message || 'Gateway request failed',
                        { suggestion: 'Check your consumer key and API slug' },
                        response.status
                    );
                }

                const data: any = await response.json();
                return {
                    content: data.choices?.[0]?.message?.content ?? '',
                    tokensUsed: data.usage?.total_tokens ?? 0,
                };
            },

            /**
             * Streaming chat completion with token-by-token callbacks.
             */
            stream: async (opts: {
                apiSlug: string;
                messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
                model?: string;
                onToken: (delta: string) => void;
                onDone?: (usage: { tokensUsed: number }) => void;
            }): Promise<void> => {
                const url = `${host}/api/gateway/${opts.apiSlug}/v1/chat/completions`;
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this._consumerKey) headers['Authorization'] = `Bearer ${this._consumerKey}`;
                else if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
                if (this.apiKey) headers['X-Aerostack-Key'] = this.apiKey;

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        messages: opts.messages,
                        stream: true,
                        ...(opts.model ? { model: opts.model } : {}),
                    }),
                });

                if (!response.ok || !response.body) {
                    const err: any = await response.json().catch(() => ({}));
                    throw new ClientError(
                        this.mapErrorCode(err.code, response.status),
                        err.error || err.message || 'Gateway stream failed',
                        { suggestion: 'Check your consumer key and API slug' },
                        response.status
                    );
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let totalTokens = 0;
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const payload = line.slice(6).trim();
                        if (payload === '[DONE]') {
                            reader.cancel();
                            opts.onDone?.({ tokensUsed: totalTokens });
                            return;
                        }
                        try {
                            const parsed = JSON.parse(payload);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) opts.onToken(delta);
                            if (parsed.usage?.total_tokens) totalTokens = parsed.usage.total_tokens;
                        } catch {
                            // Skip malformed SSE frames
                        }
                    }
                }
                opts.onDone?.({ tokensUsed: totalTokens });
            },

            /**
             * Connect a WebSocket to a gateway AI API for real-time bidirectional communication.
             */
            connectWebSocket: async (opts: {
                apiSlug: string;
                onMessage: (data: any) => void;
                onClose?: () => void;
            }): Promise<WebSocket> => {
                const wsHost = host.replace(/^http/, 'ws');
                const wsUrl = `${wsHost}/api/gateway/${opts.apiSlug}/ws`;
                const protocols: string[] = [];
                if (this._consumerKey) protocols.push(`bearer-${this._consumerKey}`);
                else if (this._token) protocols.push(`bearer-${this._token}`);

                const ws = new WebSocket(wsUrl, protocols.length > 0 ? protocols : undefined);
                ws.onmessage = (event) => {
                    try {
                        opts.onMessage(JSON.parse(event.data as string));
                    } catch {
                        opts.onMessage(event.data);
                    }
                };
                ws.onclose = () => opts.onClose?.();
                return ws;
            },

            /**
             * Get usage summary for a gateway API.
             */
            usage: async (apiSlug: string, days?: number): Promise<GatewayUsageSummary> => {
                const params = new URLSearchParams({ api_slug: apiSlug });
                if (days !== undefined) params.set('days', String(days));
                const url = `${host}/api/gateway/me/usage?${params.toString()}`;
                const headers: Record<string, string> = {};
                if (this._consumerKey) headers['Authorization'] = `Bearer ${this._consumerKey}`;
                else if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

                const response = await fetch(url, { method: 'GET', headers });
                if (!response.ok) {
                    const err: any = await response.json().catch(() => ({}));
                    throw new ClientError(
                        this.mapErrorCode(err.code, response.status),
                        err.error || err.message || 'Failed to fetch usage',
                        { suggestion: 'Ensure you are authenticated' },
                        response.status
                    );
                }
                return response.json() as Promise<GatewayUsageSummary>;
            },

            /**
             * Get current wallet balance for a gateway API.
             */
            wallet: async (apiSlug: string): Promise<GatewayWallet> => {
                const params = new URLSearchParams({ api_slug: apiSlug });
                const url = `${host}/api/gateway/me/wallet?${params.toString()}`;
                const headers: Record<string, string> = {};
                if (this._consumerKey) headers['Authorization'] = `Bearer ${this._consumerKey}`;
                else if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

                const response = await fetch(url, { method: 'GET', headers });
                if (!response.ok) {
                    const err: any = await response.json().catch(() => ({}));
                    throw new ClientError(
                        this.mapErrorCode(err.code, response.status),
                        err.error || err.message || 'Failed to fetch wallet',
                        { suggestion: 'Ensure you are authenticated' },
                        response.status
                    );
                }
                const data: any = await response.json();
                return data.wallet as GatewayWallet;
            },
        };
    }

    /**
     * AI Vector Search operations
     *
     * Ingest, query, and manage semantic vector embeddings for your project.
     * Requires a secret API key with the `ai:search` or `ai:ingest` scope.
     *
     * ```typescript
     * const sdk = new AerostackClient({ projectSlug: 'my-app', apiKey: 'sk_live_...' });
     *
     * // Ingest content
     * await sdk.ai.search.ingest('The user manual for X...', { id: 'doc-1', type: 'documentation' });
     *
     * // Semantic query
     * const { results } = await sdk.ai.search.query('How do I set up my device?', { topK: 3 });
     * ```
     */
    get ai() {
        const request = this.request.bind(this);
        return {
            search: {
                /**
                 * Ingest content into the vector index.
                 * @param content The text content to embed and store
                 * @param options id, type (required), metadata
                 */
                ingest: async (
                    content: string,
                    options: { id?: string; type: string; metadata?: Record<string, any> }
                ): Promise<{ success: boolean }> => {
                    return request('/ai/search/ingest', 'POST', { content, ...options });
                },

                /**
                 * Perform a semantic similarity search.
                 * @param text The query text
                 * @param options topK, types filter, extra filter
                 */
                query: async (
                    text: string,
                    options?: { topK?: number; types?: string[]; filter?: Record<string, any> }
                ): Promise<{ results: Array<{ id: string; content: string; score: number; type: string; metadata: Record<string, any> }> }> => {
                    return request('/ai/search/query', 'POST', { text, ...options });
                },

                /**
                 * Delete a single vector by its user-facing ID.
                 */
                delete: async (id: string): Promise<{ success: boolean }> => {
                    return request('/ai/search/delete', 'POST', { id });
                },

                /**
                 * Delete all vectors of a specific type for this project.
                 */
                deleteByType: async (type: string): Promise<{ success: boolean }> => {
                    return request('/ai/search/deleteByType', 'POST', { type });
                },

                /**
                 * List all distinct types and their vector counts.
                 */
                listTypes: async (): Promise<{ types: Array<{ type: string; count: number }> }> => {
                    return request('/ai/search/listTypes', 'GET');
                },

                /**
                 * Configure the embedding model for this project.
                 * @param embeddingModel 'english' (default, bge-base-en) or 'multilingual' (bge-m3)
                 */
                configure: async (options: { embeddingModel: 'english' | 'multilingual' }): Promise<{ success: boolean }> => {
                    return request('/ai/search/configure', 'POST', options);
                },

                /**
                 * Update an existing vector by re-embedding with new content.
                 * Equivalent to delete + ingest but preserves the original ID.
                 */
                update: async (
                    id: string,
                    content: string,
                    options?: { type?: string; metadata?: Record<string, any> }
                ): Promise<{ success: boolean }> => {
                    return request('/ai/search/update', 'POST', { id, content, ...options });
                },

                /**
                 * Get total vector count, optionally filtered by type.
                 */
                count: async (type?: string): Promise<{ count: number }> => {
                    return request('/ai/search/count', 'POST', { type });
                },

                /**
                 * Get a single vector by its user-facing ID.
                 */
                get: async (id: string): Promise<{ result: { id: string; content: string; score: number; type: string; metadata: Record<string, any> } | null; exists: boolean }> => {
                    return request('/ai/search/get', 'POST', { id });
                },
            }
        };
    }

    /**
     * Call a custom Logic Lab function (API hook)
     * Provides full autocomplete if ProjectSchema is generated.
     */
    async call<K extends keyof T['customApis'] & string>(
        slug: K,
        data: T['customApis'][K]['params'],
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'POST'
    ): Promise<T['customApis'][K]['response']> {
        return this.request(`/custom/${slug}`, method, data, undefined, { functionName: slug });
    }

    /**
     * Database and Collections operations
     */
    get db() {
        return {
            /**
             * Access a specific collection
             */
            collection: <K extends keyof T['collections'] & string>(name: K) => {
                const projectSlug = this.projectSlug;
                const request = this.request.bind(this);
                const realtime = this.realtime;

                return {
                    /**
                     * List items in the collection
                     */
                    list: async (params?: any): Promise<T['collections'][K][] | any[]> => {
                        let query = '';
                        if (params) {
                            const searchParams = new URLSearchParams();
                            for (const [key, value] of Object.entries(params)) {
                                searchParams.set(key, String(value));
                            }
                            query = `?${searchParams.toString()}`;
                        }
                        return request(`/collections/${name}/items${query}`, 'GET');
                    },

                    /**
                     * Get a single item by ID
                     */
                    get: async (id: string): Promise<T['collections'][K] | any> => {
                        return request(`/collections/items/${id}`, 'GET');
                    },

                    /**
                     * Create a new item
                     */
                    create: async (data: Partial<T['collections'][K]> | any): Promise<T['collections'][K] | any> => {
                        return request(`/collections/${name}/items`, 'POST', data);
                    },

                    /**
                     * Update an existing item
                     */
                    update: async (id: string, data: Partial<T['collections'][K]> | any): Promise<{ success: boolean }> => {
                        return request(`/collections/items/${id}`, 'PUT', data);
                    },

                    /**
                     * Delete an item
                     */
                    delete: async (id: string): Promise<{ success: boolean }> => {
                        return request(`/collections/items/${id}`, 'DELETE');
                    },

                    /**
                     * Subscribe to realtime updates for this collection
                     */
                    subscribe: (filter?: any) => {
                        const topic = `table/${name}/${projectSlug}`;
                        return realtime.channel(topic, { filter }).subscribe();
                    },

                    /**
                     * Listen to specific realtime events
                     */
                    on: (event: RealtimeEvent, callback: RealtimeCallback) => {
                        const topic = `table/${name}/${projectSlug}`;
                        return realtime.channel(topic).on(event, callback);
                    }
                };
            }
        };
    }

    /**
     * Make HTTP request with comprehensive error handling
     */
    private async request(path: string, method: string, body?: any, token?: string, options: { functionName?: string } = {}): Promise<any> {
        const url = `${this.baseUrl}${path}`;
        const requestId = crypto.randomUUID();

        const fetchOptions: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'x-request-id': requestId,
                'x-aerostack-function': options.functionName || 'api_call',
                'X-Project-Id': this.projectId || this.projectSlug,
                ...(token && { Authorization: `Bearer ${token}` }),
                ...(this.apiKey && { 'X-Aerostack-Key': this.apiKey }),
            },
        };

        if (body) {
            fetchOptions.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, fetchOptions);
            const data: any = await response.json();

            if (!response.ok) {
                // Map HTTP status codes to specific errors
                const errorCode = this.mapErrorCode(data.code, response.status);
                const errorMessage = data.message || data.error || 'Request failed';

                throw new ClientError(
                    errorCode,
                    errorMessage,
                    {
                        suggestion: this.getSuggestion(errorCode, data),
                        field: data.field,
                    },
                    response.status
                );
            }

            return data;
        } catch (err: any) {
            // If already a ClientError, re-throw
            if (err instanceof ClientError) {
                throw err;
            }

            // Network errors
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                throw new NetworkError('Network request failed', 'Check your internet connection');
            }

            if (err.name === 'AbortError') {
                throw new NetworkError('Request timeout', 'The request took too long. Please try again');
            }

            // Generic error
            throw new ClientError(
                ClientErrorCode.UNKNOWN_ERROR,
                err.message || 'An unexpected error occurred',
                {
                    suggestion: 'Please try again or contact support',
                }
            );
        }
    }

    /**
     * Map API error codes to client error codes
     */
    private mapErrorCode(apiCode: string | undefined, statusCode: number): ClientErrorCode {
        if (apiCode) {
            // Direct mapping if code exists
            if (Object.values(ClientErrorCode).includes(apiCode as any)) {
                return apiCode as ClientErrorCode;
            }
        }

        // Fallback to status code mapping
        switch (statusCode) {
            case 401:
                return ClientErrorCode.AUTH_INVALID_CREDENTIALS;
            case 409:
                return ClientErrorCode.AUTH_USER_EXISTS;
            case 400:
                return ClientErrorCode.VALIDATION_ERROR;
            case 403:
                return ClientErrorCode.AUTH_TOKEN_INVALID;
            default:
                return ClientErrorCode.REQUEST_FAILED;
        }
    }

    /**
     * Get helpful suggestion based on error code
     */
    private getSuggestion(errorCode: ClientErrorCode, data?: any): string {
        switch (errorCode) {
            case ClientErrorCode.AUTH_INVALID_CREDENTIALS:
                return 'Double-check your email and password';
            case ClientErrorCode.AUTH_USER_EXISTS:
                return 'Try logging in instead, or use password reset if you forgot your password';
            case ClientErrorCode.AUTH_EMAIL_NOT_VERIFIED:
                return 'Check your email for verification link';
            case ClientErrorCode.AUTH_TOKEN_EXPIRED:
                return 'Your session has expired. Please login again';
            case ClientErrorCode.AUTH_OTP_EXPIRED:
                return 'Request a new OTP code';
            case ClientErrorCode.AUTH_OTP_INVALID:
                return 'Check the code and try again, or request a new one';
            case ClientErrorCode.AUTH_PASSWORD_WEAK:
                return 'Use at least 8 characters with a mix of letters, numbers, and symbols';
            case ClientErrorCode.NETWORK_ERROR:
                return 'Check your internet connection and try again';
            default:
                return data?.details?.suggestion || 'Please try again or contact support';
        }
    }
}

// ─── Slug-bound Gateway API ──────────────────────────────────────────────────

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface GatewayChatOptions {
    /** The user message to send. */
    message: string;
    /** Previous conversation history. */
    history?: ChatMessage[];
    /** Model override (if the gateway supports model selection). */
    model?: string;
    /** Enable streaming. When true, onToken is called for each delta. */
    stream?: boolean;
    /** Called for each token delta during streaming. Required when stream=true. */
    onToken?: (delta: string) => void;
    /** Called when streaming finishes with usage info. */
    onDone?: (usage: { tokensUsed: number }) => void;
}

export interface GatewayChatResponse {
    content: string;
    tokensUsed: number;
}

/**
 * A slug-bound gateway API client that provides a simple chat() interface.
 *
 * Created via `client.chatApi('my-chatbot-slug')`.
 */
export class AerostackGatewayApi {
    constructor(
        private client: AerostackClient,
        private apiSlug: string,
    ) {}

    /**
     * Send a chat message. Supports both streaming and non-streaming modes.
     *
     * Non-streaming (default): returns `{ content, tokensUsed }`
     * Streaming: calls `onToken` for each delta, then `onDone` with usage.
     */
    async chat(opts: GatewayChatOptions): Promise<GatewayChatResponse> {
        const messages: ChatMessage[] = [
            ...(opts.history ?? []),
            { role: 'user', content: opts.message },
        ];

        if (opts.stream) {
            let fullContent = '';
            let totalTokens = 0;

            await this.client.gateway.stream({
                apiSlug: this.apiSlug,
                messages,
                model: opts.model,
                onToken: (delta) => {
                    fullContent += delta;
                    opts.onToken?.(delta);
                },
                onDone: (usage) => {
                    totalTokens = usage.tokensUsed;
                    opts.onDone?.(usage);
                },
            });

            return { content: fullContent, tokensUsed: totalTokens };
        }

        return this.client.gateway.complete({
            apiSlug: this.apiSlug,
            messages,
            model: opts.model,
        });
    }

    /** Get usage stats for this API. */
    async usage(days?: number): Promise<GatewayUsageSummary> {
        return this.client.gateway.usage(this.apiSlug, days);
    }

    /** Get wallet balance for this API. */
    async wallet(): Promise<GatewayWallet> {
        return this.client.gateway.wallet(this.apiSlug);
    }
}

// Re-export errors for convenience
export * from './client-errors';
