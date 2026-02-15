/**
 * Server-side error handling for Aerostack SDK
 * Provides structured errors with actionable suggestions
 */

export enum ErrorCode {
    // Database Errors
    DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
    DB_QUERY_FAILED = 'DB_QUERY_FAILED',
    DB_TABLE_NOT_FOUND = 'DB_TABLE_NOT_FOUND',
    DB_COLUMN_NOT_FOUND = 'DB_COLUMN_NOT_FOUND',
    DB_AUTH_FAILED = 'DB_AUTH_FAILED',
    DB_MIGRATION_FAILED = 'DB_MIGRATION_FAILED',
    DB_TRANSACTION_FAILED = 'DB_TRANSACTION_FAILED',

    // Cache Errors
    CACHE_GET_FAILED = 'CACHE_GET_FAILED',
    CACHE_SET_FAILED = 'CACHE_SET_FAILED',
    CACHE_DELETE_FAILED = 'CACHE_DELETE_FAILED',
    CACHE_NOT_CONFIGURED = 'CACHE_NOT_CONFIGURED',

    // Queue Errors
    QUEUE_ENQUEUE_FAILED = 'QUEUE_ENQUEUE_FAILED',
    QUEUE_NOT_CONFIGURED = 'QUEUE_NOT_CONFIGURED',
    QUEUE_JOB_NOT_FOUND = 'QUEUE_JOB_NOT_FOUND',

    // Storage Errors
    STORAGE_UPLOAD_FAILED = 'STORAGE_UPLOAD_FAILED',
    STORAGE_DELETE_FAILED = 'STORAGE_DELETE_FAILED',
    STORAGE_NOT_CONFIGURED = 'STORAGE_NOT_CONFIGURED',
    STORAGE_FILE_TOO_LARGE = 'STORAGE_FILE_TOO_LARGE',

    // AI Errors
    AI_REQUEST_FAILED = 'AI_REQUEST_FAILED',
    AI_NOT_CONFIGURED = 'AI_NOT_CONFIGURED',
    AI_RATE_LIMIT = 'AI_RATE_LIMIT',

    // Service Errors
    SERVICE_INVOKE_FAILED = 'SERVICE_INVOKE_FAILED',
    SERVICE_NOT_FOUND = 'SERVICE_NOT_FOUND',

    // General Errors
    CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ErrorDetails {
    suggestion?: string;
    recoveryAction?: string;
    field?: string;
    cause?: string;
}

/**
 * Base error class for all server-side errors
 */
export class ServerError extends Error {
    constructor(
        public code: ErrorCode,
        message: string,
        public details?: ErrorDetails,
        public context?: Record<string, any>
    ) {
        super(message);
        this.name = 'ServerError';
        Object.setPrototypeOf(this, ServerError.prototype);
    }

    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            details: this.details,
            context: this.context,
        };
    }
}

/**
 * Database-related errors
 */
export class DatabaseError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'DatabaseError';
        Object.setPrototypeOf(this, DatabaseError.prototype);
    }

    /**
     * Create error from Postgres error
     */
    static fromPostgresError(err: any, context?: Record<string, any>): DatabaseError {
        // Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
        switch (err.code) {
            case '42P01': // undefined_table
                return new DatabaseError(
                    ErrorCode.DB_TABLE_NOT_FOUND,
                    `Table does not exist: ${err.table || 'unknown'}`,
                    {
                        suggestion: 'Run migrations first: aerostack db migrate apply',
                        recoveryAction: 'CREATE_TABLE',
                        cause: err.message
                    },
                    context
                );

            case '42703': // undefined_column
                return new DatabaseError(
                    ErrorCode.DB_COLUMN_NOT_FOUND,
                    `Column does not exist: ${err.column || 'unknown'}`,
                    {
                        suggestion: 'Check your schema or run latest migrations',
                        recoveryAction: 'ALTER_TABLE',
                        cause: err.message
                    },
                    context
                );

            case '28P01': // invalid_password
            case '28000': // invalid_authorization_specification
                return new DatabaseError(
                    ErrorCode.DB_AUTH_FAILED,
                    'Database authentication failed',
                    {
                        suggestion: 'Check your DATABASE_URL environment variable',
                        recoveryAction: 'UPDATE_CREDENTIALS',
                        cause: err.message
                    },
                    context
                );

            case '08006': // connection_failure
            case '08003': // connection_does_not_exist
                return new DatabaseError(
                    ErrorCode.DB_CONNECTION_FAILED,
                    'Failed to connect to database',
                    {
                        suggestion: 'Verify your database connection string and network connectivity',
                        recoveryAction: 'CHECK_CONNECTION',
                        cause: err.message
                    },
                    context
                );

            default:
                return new DatabaseError(
                    ErrorCode.DB_QUERY_FAILED,
                    err.message || 'Database query failed',
                    {
                        suggestion: 'Check your query syntax and parameters',
                        cause: err.code ? `Postgres error ${err.code}` : undefined
                    },
                    context
                );
        }
    }

    /**
     * Create error from D1 error
     */
    static fromD1Error(err: any, context?: Record<string, any>): DatabaseError {
        const message = err.message || 'D1 query failed';

        if (message.includes('no such table')) {
            return new DatabaseError(
                ErrorCode.DB_TABLE_NOT_FOUND,
                message,
                {
                    suggestion: 'Run D1 migrations: aerostack db migrate apply',
                    recoveryAction: 'CREATE_TABLE',
                    cause: err.message
                },
                context
            );
        }

        if (message.includes('no such column')) {
            return new DatabaseError(
                ErrorCode.DB_COLUMN_NOT_FOUND,
                message,
                {
                    suggestion: 'Check your schema or update migrations',
                    recoveryAction: 'ALTER_TABLE',
                    cause: err.message
                },
                context
            );
        }

        return new DatabaseError(
            ErrorCode.DB_QUERY_FAILED,
            message,
            {
                suggestion: 'Check your SQL syntax and D1 configuration',
                cause: err.message
            },
            context
        );
    }
}

/**
 * Cache-related errors
 */
export class CacheError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'CacheError';
        Object.setPrototypeOf(this, CacheError.prototype);
    }
}

/**
 * Queue-related errors
 */
export class QueueError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'QueueError';
        Object.setPrototypeOf(this, QueueError.prototype);
    }
}

/**
 * Storage-related errors
 */
export class StorageError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'StorageError';
        Object.setPrototypeOf(this, StorageError.prototype);
    }
}

/**
 * AI-related errors
 */
export class AIError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'AIError';
        Object.setPrototypeOf(this, AIError.prototype);
    }
}

/**
 * Service invocation errors
 */
export class ServiceError extends ServerError {
    constructor(code: ErrorCode, message: string, details?: ErrorDetails, context?: Record<string, any>) {
        super(code, message, details, context);
        this.name = 'ServiceError';
        Object.setPrototypeOf(this, ServiceError.prototype);
    }
}
