import { describe, it, expect } from 'vitest';
import {
  ClientError,
  ClientErrorCode,
  AuthenticationError,
  ValidationError,
  NetworkError,
} from '../client-errors';

describe('ClientErrorCode enum', () => {
  it('should have all auth error codes', () => {
    expect(ClientErrorCode.AUTH_INVALID_CREDENTIALS).toBe('AUTH_INVALID_CREDENTIALS');
    expect(ClientErrorCode.AUTH_USER_EXISTS).toBe('AUTH_USER_EXISTS');
    expect(ClientErrorCode.AUTH_EMAIL_NOT_VERIFIED).toBe('AUTH_EMAIL_NOT_VERIFIED');
    expect(ClientErrorCode.AUTH_TOKEN_EXPIRED).toBe('AUTH_TOKEN_EXPIRED');
    expect(ClientErrorCode.AUTH_TOKEN_INVALID).toBe('AUTH_TOKEN_INVALID');
    expect(ClientErrorCode.AUTH_OTP_EXPIRED).toBe('AUTH_OTP_EXPIRED');
    expect(ClientErrorCode.AUTH_OTP_INVALID).toBe('AUTH_OTP_INVALID');
    expect(ClientErrorCode.AUTH_PASSWORD_WEAK).toBe('AUTH_PASSWORD_WEAK');
    expect(ClientErrorCode.AUTH_RESET_TOKEN_INVALID).toBe('AUTH_RESET_TOKEN_INVALID');
  });

  it('should have network error codes', () => {
    expect(ClientErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR');
    expect(ClientErrorCode.NETWORK_TIMEOUT).toBe('NETWORK_TIMEOUT');
  });

  it('should have validation error code', () => {
    expect(ClientErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
  });

  it('should have general error codes', () => {
    expect(ClientErrorCode.REQUEST_FAILED).toBe('REQUEST_FAILED');
    expect(ClientErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR');
  });
});

describe('ClientError', () => {
  describe('constructor', () => {
    it('should set code, message, details, and statusCode', () => {
      const err = new ClientError(
        ClientErrorCode.REQUEST_FAILED,
        'Request failed',
        { suggestion: 'Retry' },
        500,
      );
      expect(err.code).toBe(ClientErrorCode.REQUEST_FAILED);
      expect(err.message).toBe('Request failed');
      expect(err.details?.suggestion).toBe('Retry');
      expect(err.statusCode).toBe(500);
    });

    it('should set name to "ClientError"', () => {
      const err = new ClientError(ClientErrorCode.UNKNOWN_ERROR, 'test');
      expect(err.name).toBe('ClientError');
    });

    it('should be an instance of Error', () => {
      const err = new ClientError(ClientErrorCode.UNKNOWN_ERROR, 'test');
      expect(err).toBeInstanceOf(Error);
    });

    it('should be an instance of ClientError', () => {
      const err = new ClientError(ClientErrorCode.UNKNOWN_ERROR, 'test');
      expect(err).toBeInstanceOf(ClientError);
    });

    it('should work without optional params', () => {
      const err = new ClientError(ClientErrorCode.UNKNOWN_ERROR, 'test');
      expect(err.details).toBeUndefined();
      expect(err.statusCode).toBeUndefined();
    });
  });

  describe('isAuthError', () => {
    it('should return true for all AUTH_ codes', () => {
      const authCodes = [
        ClientErrorCode.AUTH_INVALID_CREDENTIALS,
        ClientErrorCode.AUTH_USER_EXISTS,
        ClientErrorCode.AUTH_EMAIL_NOT_VERIFIED,
        ClientErrorCode.AUTH_TOKEN_EXPIRED,
        ClientErrorCode.AUTH_TOKEN_INVALID,
        ClientErrorCode.AUTH_OTP_EXPIRED,
        ClientErrorCode.AUTH_OTP_INVALID,
        ClientErrorCode.AUTH_PASSWORD_WEAK,
        ClientErrorCode.AUTH_RESET_TOKEN_INVALID,
      ];
      for (const code of authCodes) {
        const err = new ClientError(code, 'test');
        expect(err.isAuthError()).toBe(true);
      }
    });

    it('should return false for non-auth codes', () => {
      const nonAuthCodes = [
        ClientErrorCode.NETWORK_ERROR,
        ClientErrorCode.NETWORK_TIMEOUT,
        ClientErrorCode.VALIDATION_ERROR,
        ClientErrorCode.REQUEST_FAILED,
        ClientErrorCode.UNKNOWN_ERROR,
      ];
      for (const code of nonAuthCodes) {
        const err = new ClientError(code, 'test');
        expect(err.isAuthError()).toBe(false);
      }
    });
  });

  describe('isNetworkError', () => {
    it('should return true for NETWORK_ERROR', () => {
      const err = new ClientError(ClientErrorCode.NETWORK_ERROR, 'test');
      expect(err.isNetworkError()).toBe(true);
    });

    it('should return true for NETWORK_TIMEOUT', () => {
      const err = new ClientError(ClientErrorCode.NETWORK_TIMEOUT, 'test');
      expect(err.isNetworkError()).toBe(true);
    });

    it('should return false for non-network codes', () => {
      const err = new ClientError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'test');
      expect(err.isNetworkError()).toBe(false);
    });
  });

  describe('isValidationError', () => {
    it('should return true for VALIDATION_ERROR', () => {
      const err = new ClientError(ClientErrorCode.VALIDATION_ERROR, 'test');
      expect(err.isValidationError()).toBe(true);
    });

    it('should return false for non-validation codes', () => {
      const err = new ClientError(ClientErrorCode.REQUEST_FAILED, 'test');
      expect(err.isValidationError()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON with all fields', () => {
      const err = new ClientError(
        ClientErrorCode.AUTH_TOKEN_EXPIRED,
        'Token expired',
        { suggestion: 'Refresh token', field: 'token', recoveryAction: 'REFRESH' },
        401,
      );
      const json = err.toJSON();
      expect(json).toEqual({
        name: 'ClientError',
        code: 'AUTH_TOKEN_EXPIRED',
        message: 'Token expired',
        details: { suggestion: 'Refresh token', field: 'token', recoveryAction: 'REFRESH' },
        statusCode: 401,
      });
    });

    it('should serialize with undefined details and statusCode', () => {
      const err = new ClientError(ClientErrorCode.UNKNOWN_ERROR, 'test');
      const json = err.toJSON();
      expect(json.details).toBeUndefined();
      expect(json.statusCode).toBeUndefined();
    });
  });
});

describe('AuthenticationError', () => {
  it('should set name to "AuthenticationError"', () => {
    const err = new AuthenticationError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'Bad creds');
    expect(err.name).toBe('AuthenticationError');
  });

  it('should be an instance of ClientError', () => {
    const err = new AuthenticationError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'Bad creds');
    expect(err).toBeInstanceOf(ClientError);
  });

  it('should be an instance of Error', () => {
    const err = new AuthenticationError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'Bad creds');
    expect(err).toBeInstanceOf(Error);
  });

  it('should be an instance of AuthenticationError', () => {
    const err = new AuthenticationError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'Bad creds');
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it('isAuthError should return true', () => {
    const err = new AuthenticationError(ClientErrorCode.AUTH_INVALID_CREDENTIALS, 'Bad creds');
    expect(err.isAuthError()).toBe(true);
  });

  it('should accept optional details and statusCode', () => {
    const err = new AuthenticationError(
      ClientErrorCode.AUTH_USER_EXISTS,
      'User exists',
      { suggestion: 'Try login' },
      409,
    );
    expect(err.details?.suggestion).toBe('Try login');
    expect(err.statusCode).toBe(409);
  });
});

describe('ValidationError', () => {
  it('should set name to "ValidationError"', () => {
    const err = new ValidationError('Invalid email');
    expect(err.name).toBe('ValidationError');
  });

  it('should set code to VALIDATION_ERROR', () => {
    const err = new ValidationError('test');
    expect(err.code).toBe(ClientErrorCode.VALIDATION_ERROR);
  });

  it('should set statusCode to 400', () => {
    const err = new ValidationError('test');
    expect(err.statusCode).toBe(400);
  });

  it('should be an instance of ClientError', () => {
    const err = new ValidationError('test');
    expect(err).toBeInstanceOf(ClientError);
  });

  it('should set field in details', () => {
    const err = new ValidationError('Invalid email', 'email');
    expect(err.details?.field).toBe('email');
  });

  it('should set suggestion in details', () => {
    const err = new ValidationError('Invalid email', 'email', 'Use a valid email');
    expect(err.details?.suggestion).toBe('Use a valid email');
  });

  it('isValidationError should return true', () => {
    const err = new ValidationError('test');
    expect(err.isValidationError()).toBe(true);
  });
});

describe('NetworkError', () => {
  it('should set name to "NetworkError"', () => {
    const err = new NetworkError('Connection failed');
    expect(err.name).toBe('NetworkError');
  });

  it('should set code to NETWORK_ERROR', () => {
    const err = new NetworkError('test');
    expect(err.code).toBe(ClientErrorCode.NETWORK_ERROR);
  });

  it('should be an instance of ClientError', () => {
    const err = new NetworkError('test');
    expect(err).toBeInstanceOf(ClientError);
  });

  it('should set suggestion in details', () => {
    const err = new NetworkError('Offline', 'Check connection');
    expect(err.details?.suggestion).toBe('Check connection');
  });

  it('isNetworkError should return true', () => {
    const err = new NetworkError('test');
    expect(err.isNetworkError()).toBe(true);
  });

  it('should work without suggestion', () => {
    const err = new NetworkError('Connection failed');
    expect(err.details?.suggestion).toBeUndefined();
  });
});
