/**
 * Client-side error handling for Aerostack SDK
 */

export enum ClientErrorCode {
    // Authentication Errors
    AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
    AUTH_USER_EXISTS = 'AUTH_USER_EXISTS',
    AUTH_EMAIL_NOT_VERIFIED = 'AUTH_EMAIL_NOT_VERIFIED',
    AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
    AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
    AUTH_OTP_EXPIRED = 'AUTH_OTP_EXPIRED',
    AUTH_OTP_INVALID = 'AUTH_OTP_INVALID',
    AUTH_PASSWORD_WEAK = 'AUTH_PASSWORD_WEAK',
    AUTH_RESET_TOKEN_INVALID = 'AUTH_RESET_TOKEN_INVALID',

    // Network Errors
    NETWORK_ERROR = 'NETWORK_ERROR',
    NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',

    // Validation Errors
    VALIDATION_ERROR = 'VALIDATION_ERROR',

    // General Errors
    REQUEST_FAILED = 'REQUEST_FAILED',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

export interface ClientErrorDetails {
    suggestion?: string;
    field?: string;
    recoveryAction?: string;
}

/**
 * Base error class for client-side SDK
 */
export class ClientError extends Error {
    constructor(
        public code: ClientErrorCode,
        message: string,
        public details?: ClientErrorDetails,
        public statusCode?: number
    ) {
        super(message);
        this.name = 'ClientError';
        Object.setPrototypeOf(this, ClientError.prototype);
    }

    /**
     * Check if this is an authentication error
     */
    isAuthError(): boolean {
        return this.code.toString().startsWith('AUTH_');
    }

    /**
     * Check if this is a network error
     */
    isNetworkError(): boolean {
        return this.code === ClientErrorCode.NETWORK_ERROR || this.code === ClientErrorCode.NETWORK_TIMEOUT;
    }

    /**
     * Check if this is a validation error
     */
    isValidationError(): boolean {
        return this.code === ClientErrorCode.VALIDATION_ERROR;
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            statusCode: this.statusCode,
        };
    }
}

/**
 * Authentication-specific errors
 */
export class AuthenticationError extends ClientError {
    constructor(code: ClientErrorCode, message: string, details?: ClientErrorDetails, statusCode?: number) {
        super(code, message, details, statusCode);
        this.name = 'AuthenticationError';
        Object.setPrototypeOf(this, AuthenticationError.prototype);
    }
}

/**
 * Validation-specific errors
 */
export class ValidationError extends ClientError {
    constructor(message: string, field?: string, suggestion?: string) {
        super(
            ClientErrorCode.VALIDATION_ERROR,
            message,
            { field, suggestion },
            400
        );
        this.name = 'ValidationError';
        Object.setPrototypeOf(this, ValidationError.prototype);
    }
}

/**
 * Network-specific errors
 */
export class NetworkError extends ClientError {
    constructor(message: string, suggestion?: string) {
        super(
            ClientErrorCode.NETWORK_ERROR,
            message,
            { suggestion }
        );
        this.name = 'NetworkError';
        Object.setPrototypeOf(this, NetworkError.prototype);
    }
}
