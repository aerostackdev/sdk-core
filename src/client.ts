import { ClientError, ClientErrorCode, AuthenticationError, ValidationError, NetworkError } from './client-errors';
import { RealtimeClient, RealtimeEvent, RealtimeCallback } from './realtime';

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
    customFields?: Record<string, any>;
}

/**
 * Aerostack Client SDK
 * 
 * Provides client-side authentication, database access, and 
 * custom logic invocation with full type-safety.
 */
export class AerostackClient<T extends DefaultProjectSchema = DefaultProjectSchema> {
    private projectSlug: string;
    private projectId?: string;
    private baseUrl: string;
    private apiKey?: string;
    private _realtime: RealtimeClient | null = null;
    private _token?: string;
    private _userId?: string;

    constructor(config: SDKConfig) {
        this.projectSlug = config.projectSlug;
        this.projectId = config.projectId;
        this.baseUrl = config.baseUrl || 'https://api.aerostack.ai/v1';
        this.apiKey = config.apiKey;
    }

    /**
     * Authentication operations
     */
    get auth() {
        return {
            /**
             * Register a new user
             */
            register: async (data: RegisterData): Promise<AuthResponse> => {
                // Client-side validation
                if (!data.email || !data.email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email', 'Provide a valid email address');
                }

                if (!data.password || data.password.length < 8) {
                    throw new ValidationError(
                        'Password must be at least 8 characters',
                        'password',
                        'Use a stronger password with minimum 8 characters'
                    );
                }

                return this.request('/auth/signup', 'POST', {
                    email: data.email,
                    password: data.password,
                    name: data.name,
                    metadata: data.customFields
                });
            },

            /**
             * Login with email and password
             */
            login: async (email: string, password: string): Promise<AuthResponse> => {
                if (!email || !password) {
                    throw new ValidationError('Email and password are required', 'email');
                }

                return this.request('/auth/signin', 'POST', { email, password });
            },

            /**
             * Send OTP code to email
             */
            sendOTP: async (email: string): Promise<OTPResponse> => {
                if (!email || !email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email');
                }

                return this.request('/auth/otp/send', 'POST', { email });
            },

            /**
             * Verify OTP code and login
             */
            verifyOTP: async (email: string, code: string): Promise<AuthResponse> => {
                if (!email || !code) {
                    throw new ValidationError('Email and code are required');
                }

                if (code.length !== 6 || !/^\d+$/.test(code)) {
                    throw new ValidationError('OTP code must be 6 digits', 'code');
                }

                return this.request('/auth/otp/verify', 'POST', { email, code });
            },

            /**
             * Verify email with token
             */
            verifyEmail: async (token: string): Promise<VerifyResponse> => {
                if (!token) {
                    throw new ValidationError('Verification token is required', 'token');
                }

                return this.request(`/auth/verify-email?token=${token}`, 'GET');
            },

            /**
             * Request password reset email
             */
            requestPasswordReset: async (email: string): Promise<ResetResponse> => {
                if (!email || !email.includes('@')) {
                    throw new ValidationError('Invalid email address', 'email');
                }

                return this.request('/auth/password-reset/request', 'POST', { email });
            },

            /**
             * Reset password with token
             */
            resetPassword: async (token: string, newPassword: string): Promise<AuthResponse> => {
                if (!token) {
                    throw new ValidationError('Reset token is required', 'token');
                }

                if (!newPassword || newPassword.length < 8) {
                    throw new ValidationError(
                        'Password must be at least 8 characters',
                        'password',
                        'Use a stronger password'
                    );
                }

                return this.request('/auth/password-reset/confirm', 'POST', { token, newPassword });
            },

            /**
             * Refresh access token using refresh token
             */
            refreshToken: async (refreshToken: string): Promise<AuthResponse> => {
                if (!refreshToken) {
                    throw new ValidationError('Refresh token is required', 'refreshToken');
                }

                return this.request('/auth/refresh', 'POST', { refreshToken });
            },

            /**
             * Logout and invalidate tokens
             */
            logout: async (token: string): Promise<LogoutResponse> => {
                return this.request('/auth/logout', 'POST', {}, token);
            },

            /**
             * Get current user profile
             */
            getCurrentUser: async (token: string): Promise<User> => {
                if (!token) {
                    throw new AuthenticationError(
                        ClientErrorCode.AUTH_TOKEN_INVALID,
                        'Authentication token is required',
                        { suggestion: 'Please login first' }
                    );
                }

                const response = await this.request('/auth/me', 'GET', undefined, token);
                return response.user;
            },

            /**
             * Update user profile
             */
            updateProfile: async (token: string, updates: ProfileUpdate): Promise<User> => {
                if (!token) {
                    throw new AuthenticationError(
                        ClientErrorCode.AUTH_TOKEN_INVALID,
                        'Authentication token is required',
                        { suggestion: 'Please login first' }
                    );
                }

                const response = await this.request('/auth/me', 'PATCH', updates, token);
                this._token = token;
                this._userId = response.user.id;
                return response.user;
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

// Re-export errors for convenience
export * from './client-errors';
