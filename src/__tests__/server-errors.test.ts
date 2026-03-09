import { describe, it, expect } from 'vitest';
import {
  ServerError,
  ErrorCode,
  DatabaseError,
  CacheError,
  QueueError,
  StorageError,
  AIError,
  ServiceError,
} from '../server-errors';

describe('ErrorCode enum', () => {
  it('should have all database error codes', () => {
    expect(ErrorCode.DB_CONNECTION_FAILED).toBe('DB_CONNECTION_FAILED');
    expect(ErrorCode.DB_QUERY_FAILED).toBe('DB_QUERY_FAILED');
    expect(ErrorCode.DB_TABLE_NOT_FOUND).toBe('DB_TABLE_NOT_FOUND');
    expect(ErrorCode.DB_COLUMN_NOT_FOUND).toBe('DB_COLUMN_NOT_FOUND');
    expect(ErrorCode.DB_AUTH_FAILED).toBe('DB_AUTH_FAILED');
    expect(ErrorCode.DB_MIGRATION_FAILED).toBe('DB_MIGRATION_FAILED');
    expect(ErrorCode.DB_TRANSACTION_FAILED).toBe('DB_TRANSACTION_FAILED');
  });

  it('should have all cache error codes', () => {
    expect(ErrorCode.CACHE_GET_FAILED).toBe('CACHE_GET_FAILED');
    expect(ErrorCode.CACHE_SET_FAILED).toBe('CACHE_SET_FAILED');
    expect(ErrorCode.CACHE_DELETE_FAILED).toBe('CACHE_DELETE_FAILED');
    expect(ErrorCode.CACHE_NOT_CONFIGURED).toBe('CACHE_NOT_CONFIGURED');
  });

  it('should have all queue error codes', () => {
    expect(ErrorCode.QUEUE_ENQUEUE_FAILED).toBe('QUEUE_ENQUEUE_FAILED');
    expect(ErrorCode.QUEUE_NOT_CONFIGURED).toBe('QUEUE_NOT_CONFIGURED');
    expect(ErrorCode.QUEUE_JOB_NOT_FOUND).toBe('QUEUE_JOB_NOT_FOUND');
  });

  it('should have all storage error codes', () => {
    expect(ErrorCode.STORAGE_UPLOAD_FAILED).toBe('STORAGE_UPLOAD_FAILED');
    expect(ErrorCode.STORAGE_DELETE_FAILED).toBe('STORAGE_DELETE_FAILED');
    expect(ErrorCode.STORAGE_NOT_CONFIGURED).toBe('STORAGE_NOT_CONFIGURED');
    expect(ErrorCode.STORAGE_FILE_TOO_LARGE).toBe('STORAGE_FILE_TOO_LARGE');
  });

  it('should have all AI error codes', () => {
    expect(ErrorCode.AI_REQUEST_FAILED).toBe('AI_REQUEST_FAILED');
    expect(ErrorCode.AI_NOT_CONFIGURED).toBe('AI_NOT_CONFIGURED');
    expect(ErrorCode.AI_RATE_LIMIT).toBe('AI_RATE_LIMIT');
  });

  it('should have all service error codes', () => {
    expect(ErrorCode.SERVICE_INVOKE_FAILED).toBe('SERVICE_INVOKE_FAILED');
    expect(ErrorCode.SERVICE_NOT_FOUND).toBe('SERVICE_NOT_FOUND');
  });

  it('should have general error codes', () => {
    expect(ErrorCode.CONFIGURATION_ERROR).toBe('CONFIGURATION_ERROR');
    expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});

describe('ServerError', () => {
  describe('constructor', () => {
    it('should set all properties', () => {
      const err = new ServerError(
        ErrorCode.INTERNAL_ERROR,
        'Something broke',
        { suggestion: 'Retry', cause: 'timeout' },
        { requestId: 'r1' },
      );
      expect(err.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(err.message).toBe('Something broke');
      expect(err.details?.suggestion).toBe('Retry');
      expect(err.details?.cause).toBe('timeout');
      expect(err.context?.requestId).toBe('r1');
    });

    it('should set name to "ServerError"', () => {
      const err = new ServerError(ErrorCode.INTERNAL_ERROR, 'test');
      expect(err.name).toBe('ServerError');
    });

    it('should be an instance of Error', () => {
      const err = new ServerError(ErrorCode.INTERNAL_ERROR, 'test');
      expect(err).toBeInstanceOf(Error);
    });

    it('should work without optional params', () => {
      const err = new ServerError(ErrorCode.INTERNAL_ERROR, 'test');
      expect(err.details).toBeUndefined();
      expect(err.context).toBeUndefined();
    });
  });

  describe('toJSON', () => {
    it('should serialize with all fields', () => {
      const err = new ServerError(
        ErrorCode.DB_QUERY_FAILED,
        'Query failed',
        { suggestion: 'Fix SQL' },
        { sql: 'SELECT *' },
      );
      const json = err.toJSON();
      expect(json).toEqual({
        name: 'ServerError',
        code: 'DB_QUERY_FAILED',
        message: 'Query failed',
        details: { suggestion: 'Fix SQL' },
        context: { sql: 'SELECT *' },
      });
    });

    it('should serialize with undefined optional fields', () => {
      const err = new ServerError(ErrorCode.INTERNAL_ERROR, 'test');
      const json = err.toJSON();
      expect(json.details).toBeUndefined();
      expect(json.context).toBeUndefined();
    });
  });
});

describe('DatabaseError', () => {
  it('should set name to "DatabaseError"', () => {
    const err = new DatabaseError(ErrorCode.DB_QUERY_FAILED, 'Query failed');
    expect(err.name).toBe('DatabaseError');
  });

  it('should be an instance of ServerError', () => {
    const err = new DatabaseError(ErrorCode.DB_QUERY_FAILED, 'Query failed');
    expect(err).toBeInstanceOf(ServerError);
  });

  it('should be an instance of DatabaseError', () => {
    const err = new DatabaseError(ErrorCode.DB_QUERY_FAILED, 'Query failed');
    expect(err).toBeInstanceOf(DatabaseError);
  });

  describe('fromPostgresError', () => {
    it('should map 42P01 to DB_TABLE_NOT_FOUND', () => {
      const err = DatabaseError.fromPostgresError(
        { code: '42P01', table: 'users', message: 'relation does not exist' },
        { sql: 'SELECT * FROM users' },
      );
      expect(err.code).toBe(ErrorCode.DB_TABLE_NOT_FOUND);
      expect(err.message).toContain('users');
      expect(err.details?.suggestion).toContain('migrations');
      expect(err.details?.recoveryAction).toBe('CREATE_TABLE');
      expect(err.context?.sql).toBe('SELECT * FROM users');
    });

    it('should handle 42P01 without table name', () => {
      const err = DatabaseError.fromPostgresError({ code: '42P01', message: 'not found' });
      expect(err.message).toContain('unknown');
    });

    it('should map 42703 to DB_COLUMN_NOT_FOUND', () => {
      const err = DatabaseError.fromPostgresError(
        { code: '42703', column: 'age', message: 'column does not exist' },
      );
      expect(err.code).toBe(ErrorCode.DB_COLUMN_NOT_FOUND);
      expect(err.message).toContain('age');
      expect(err.details?.recoveryAction).toBe('ALTER_TABLE');
    });

    it('should handle 42703 without column name', () => {
      const err = DatabaseError.fromPostgresError({ code: '42703', message: 'not found' });
      expect(err.message).toContain('unknown');
    });

    it('should map 28P01 to DB_AUTH_FAILED', () => {
      const err = DatabaseError.fromPostgresError({ code: '28P01', message: 'invalid password' });
      expect(err.code).toBe(ErrorCode.DB_AUTH_FAILED);
      expect(err.details?.suggestion).toContain('DATABASE_URL');
      expect(err.details?.recoveryAction).toBe('UPDATE_CREDENTIALS');
    });

    it('should map 28000 to DB_AUTH_FAILED', () => {
      const err = DatabaseError.fromPostgresError({ code: '28000', message: 'auth spec' });
      expect(err.code).toBe(ErrorCode.DB_AUTH_FAILED);
    });

    it('should map 08006 to DB_CONNECTION_FAILED', () => {
      const err = DatabaseError.fromPostgresError({ code: '08006', message: 'connection failure' });
      expect(err.code).toBe(ErrorCode.DB_CONNECTION_FAILED);
      expect(err.details?.recoveryAction).toBe('CHECK_CONNECTION');
    });

    it('should map 08003 to DB_CONNECTION_FAILED', () => {
      const err = DatabaseError.fromPostgresError({ code: '08003', message: 'no connection' });
      expect(err.code).toBe(ErrorCode.DB_CONNECTION_FAILED);
    });

    it('should map unknown codes to DB_QUERY_FAILED', () => {
      const err = DatabaseError.fromPostgresError({ code: '99999', message: 'unknown error' });
      expect(err.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(err.details?.cause).toContain('99999');
    });

    it('should handle error without code', () => {
      const err = DatabaseError.fromPostgresError({ message: 'generic error' });
      expect(err.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(err.details?.cause).toBeUndefined();
    });

    it('should handle error without message', () => {
      const err = DatabaseError.fromPostgresError({ code: '99999' });
      expect(err.message).toBe('Database query failed');
    });
  });

  describe('fromD1Error', () => {
    it('should map "no such table" to DB_TABLE_NOT_FOUND', () => {
      const err = DatabaseError.fromD1Error({ message: 'no such table: users' });
      expect(err.code).toBe(ErrorCode.DB_TABLE_NOT_FOUND);
      expect(err.details?.suggestion).toContain('D1 migrations');
      expect(err.details?.recoveryAction).toBe('CREATE_TABLE');
    });

    it('should map "no such column" to DB_COLUMN_NOT_FOUND', () => {
      const err = DatabaseError.fromD1Error({ message: 'no such column: age' });
      expect(err.code).toBe(ErrorCode.DB_COLUMN_NOT_FOUND);
      expect(err.details?.recoveryAction).toBe('ALTER_TABLE');
    });

    it('should map unknown D1 errors to DB_QUERY_FAILED', () => {
      const err = DatabaseError.fromD1Error({ message: 'syntax error' });
      expect(err.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(err.details?.suggestion).toContain('SQL syntax');
    });

    it('should handle D1 error without message', () => {
      const err = DatabaseError.fromD1Error({});
      expect(err.code).toBe(ErrorCode.DB_QUERY_FAILED);
      expect(err.message).toBe('D1 query failed');
    });

    it('should pass context through', () => {
      const err = DatabaseError.fromD1Error(
        { message: 'no such table: x' },
        { binding: 'DB' },
      );
      expect(err.context?.binding).toBe('DB');
    });
  });
});

describe('CacheError', () => {
  it('should set name to "CacheError"', () => {
    const err = new CacheError(ErrorCode.CACHE_GET_FAILED, 'Get failed');
    expect(err.name).toBe('CacheError');
  });

  it('should be an instance of ServerError', () => {
    const err = new CacheError(ErrorCode.CACHE_GET_FAILED, 'test');
    expect(err).toBeInstanceOf(ServerError);
  });

  it('should accept all constructor params', () => {
    const err = new CacheError(
      ErrorCode.CACHE_NOT_CONFIGURED,
      'KV not bound',
      { suggestion: 'Add KV binding' },
      { binding: 'CACHE' },
    );
    expect(err.code).toBe(ErrorCode.CACHE_NOT_CONFIGURED);
    expect(err.context?.binding).toBe('CACHE');
  });
});

describe('QueueError', () => {
  it('should set name to "QueueError"', () => {
    const err = new QueueError(ErrorCode.QUEUE_ENQUEUE_FAILED, 'Enqueue failed');
    expect(err.name).toBe('QueueError');
  });

  it('should be an instance of ServerError', () => {
    const err = new QueueError(ErrorCode.QUEUE_NOT_CONFIGURED, 'test');
    expect(err).toBeInstanceOf(ServerError);
  });
});

describe('StorageError', () => {
  it('should set name to "StorageError"', () => {
    const err = new StorageError(ErrorCode.STORAGE_UPLOAD_FAILED, 'Upload failed');
    expect(err.name).toBe('StorageError');
  });

  it('should be an instance of ServerError', () => {
    const err = new StorageError(ErrorCode.STORAGE_FILE_TOO_LARGE, 'test');
    expect(err).toBeInstanceOf(ServerError);
  });
});

describe('AIError', () => {
  it('should set name to "AIError"', () => {
    const err = new AIError(ErrorCode.AI_REQUEST_FAILED, 'AI failed');
    expect(err.name).toBe('AIError');
  });

  it('should be an instance of ServerError', () => {
    const err = new AIError(ErrorCode.AI_RATE_LIMIT, 'test');
    expect(err).toBeInstanceOf(ServerError);
  });
});

describe('ServiceError', () => {
  it('should set name to "ServiceError"', () => {
    const err = new ServiceError(ErrorCode.SERVICE_INVOKE_FAILED, 'Invoke failed');
    expect(err.name).toBe('ServiceError');
  });

  it('should be an instance of ServerError', () => {
    const err = new ServiceError(ErrorCode.SERVICE_NOT_FOUND, 'test');
    expect(err).toBeInstanceOf(ServerError);
  });
});
