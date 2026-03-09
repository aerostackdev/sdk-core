/**
 * SDK Package E2E Tests
 *
 * Tests the universal SDK exports, error classes, config, and community tools.
 * Imports from source since subpath exports (client-errors, server-errors, config)
 * are not in the package exports map.
 */
import { describe, it, expect } from 'vitest';
import { AerostackClient, AerostackServer, Aerostack, sdk } from '@aerostack/sdk';
// Import error classes from source paths directly (not in package exports map)
import {
  ClientError, ClientErrorCode,
  AuthenticationError, ValidationError, NetworkError,
} from '../../../src/client-errors';
import {
  ServerError, ErrorCode,
  DatabaseError, CacheError,
} from '../../../src/server-errors';
import { DEFAULT_API_URL as CONFIG_URL } from '../../../src/config';

describe('SDK Exports E2E', () => {
  it('should export AerostackClient constructor', () => {
    expect(typeof AerostackClient).toBe('function');
  });

  it('should export AerostackServer constructor', () => {
    expect(typeof AerostackServer).toBe('function');
  });

  it('should export Aerostack as alias for AerostackClient', () => {
    expect(Aerostack).toBe(AerostackClient);
  });

  it('should export sdk singleton with init method', () => {
    expect(sdk).toBeDefined();
    expect(typeof sdk.init).toBe('function');
  });
});

describe('SDK Client Init E2E', () => {
  it('should initialize in client mode with projectSlug', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    sdk.init({ projectSlug: 'e2e-test-project' });
    expect((sdk as any)._client).not.toBeNull();
  });

  it('should provide auth after client init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    sdk.init({ projectSlug: 'e2e-test-project' });
    expect(sdk.auth).toBeDefined();
  });

  it('should throw when accessing db before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.db).toThrow('SDK not initialized');
  });
});

describe('Client Error Hierarchy E2E', () => {
  it('should create AuthenticationError with all fields', () => {
    const err = new AuthenticationError(
      ClientErrorCode.AUTH_INVALID_CREDENTIALS,
      'Bad password',
      { suggestion: 'Check password' },
      401,
    );
    expect(err).toBeInstanceOf(ClientError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AuthenticationError');
    expect(err.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(err.isAuthError()).toBe(true);
    expect(err.isNetworkError()).toBe(false);
    expect(err.statusCode).toBe(401);
  });

  it('should create ValidationError', () => {
    const err = new ValidationError('Invalid email', 'email', 'Use valid format');
    expect(err.code).toBe(ClientErrorCode.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
    expect(err.details?.field).toBe('email');
    expect(err.isValidationError()).toBe(true);
  });

  it('should create NetworkError', () => {
    const err = new NetworkError('Connection failed', 'Check internet');
    expect(err.code).toBe(ClientErrorCode.NETWORK_ERROR);
    expect(err.isNetworkError()).toBe(true);
  });

  it('should serialize to JSON', () => {
    const err = new ClientError(ClientErrorCode.REQUEST_FAILED, 'oops', undefined, 500);
    const json = err.toJSON();
    expect(json.name).toBe('ClientError');
    expect(json.code).toBe('REQUEST_FAILED');
    expect(json.statusCode).toBe(500);
  });
});

describe('Server Error Hierarchy E2E', () => {
  it('should create DatabaseError from Postgres error', () => {
    const err = DatabaseError.fromPostgresError(
      { code: '42P01', table: 'users', message: 'relation does not exist' },
      { sql: 'SELECT * FROM users' },
    );
    expect(err).toBeInstanceOf(ServerError);
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err.code).toBe(ErrorCode.DB_TABLE_NOT_FOUND);
    expect(err.context?.sql).toBe('SELECT * FROM users');
  });

  it('should create DatabaseError from D1 error', () => {
    const err = DatabaseError.fromD1Error({ message: 'no such table: posts' });
    expect(err.code).toBe(ErrorCode.DB_TABLE_NOT_FOUND);
    expect(err.details?.recoveryAction).toBe('CREATE_TABLE');
  });

  it('should create CacheError', () => {
    const err = new CacheError(ErrorCode.CACHE_NOT_CONFIGURED, 'KV not bound');
    expect(err).toBeInstanceOf(ServerError);
    expect(err.name).toBe('CacheError');
  });
});

describe('Config E2E', () => {
  it('should export correct default API URL', () => {
    expect(CONFIG_URL).toBe('https://api.aerostack.dev/v1');
  });
});
