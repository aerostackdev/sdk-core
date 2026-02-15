import { ClientError, ClientErrorCode, AuthenticationError, ValidationError, NetworkError } from './client-errors';

export interface SDKConfig {
    projectSlug: string;
    baseUrl?: string;
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
 * Provides client-side authentication and (future) ecommerce features
 * Focused on:
 * - Complete authentication flows
 * - Password reset
 * - Session management
 * - User profile management
 */
export class AerostackClient {
    private projectSlug: string;
    private baseUrl: string;

    constructor(config: SDKConfig) {
        this.projectSlug = config.projectSlug;
        this.baseUrl = config.baseUrl || 'https://api.aerostack.app';
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

                return this.request('/auth/register', 'POST', data);
            },

            /**
             * Login with email and password
             */
            login: async (email: string, password: string): Promise<AuthResponse> => {
                if (!email || !password) {
                    throw new ValidationError('Email and password are required', 'email');
                }

                return this.request('/auth/login', 'POST', { email, password });
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
                return response.user;
            },
        };
    }

    /**
     * Make HTTP request with comprehensive error handling
     */
    private async request(path: string, method: string, body?: any, token?: string): Promise<any> {
        const url = `${this.baseUrl}/api/v1/public/projects/${this.projectSlug}${path}`;

        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` }),
            },
        };

        if (body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
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
