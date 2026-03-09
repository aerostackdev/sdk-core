import { describe, it, expect } from 'vitest';
import { sdk, AerostackClient, AerostackServer, Aerostack } from '../index';

describe('SDK exports', () => {
  it('should export AerostackClient', () => {
    expect(AerostackClient).toBeDefined();
    expect(typeof AerostackClient).toBe('function');
  });

  it('should export AerostackServer', () => {
    expect(AerostackServer).toBeDefined();
    expect(typeof AerostackServer).toBe('function');
  });

  it('should export Aerostack as alias for AerostackClient', () => {
    expect(Aerostack).toBe(AerostackClient);
  });
});

describe('SDK singleton', () => {
  it('should export sdk object', () => {
    expect(sdk).toBeDefined();
    expect(typeof sdk).toBe('object');
  });

  it('should have init method', () => {
    expect(typeof sdk.init).toBe('function');
  });

  it('should throw when accessing db before init', () => {
    // Reset state
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.db).toThrow('SDK not initialized');
  });

  it('should throw when accessing cache before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.cache).toThrow('SDK not initialized');
  });

  it('should throw when accessing queue before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.queue).toThrow('SDK not initialized');
  });

  it('should throw when accessing storage before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.storage).toThrow('SDK not initialized');
  });

  it('should throw when accessing ai before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.ai).toThrow('SDK not initialized');
  });

  it('should throw when accessing services before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.services).toThrow('SDK not initialized');
  });

  it('should throw when accessing ecommerce before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.ecommerce).toThrow('SDK not initialized');
  });

  it('should throw when accessing socket before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.socket).toThrow('SDK not initialized');
  });

  it('should throw when accessing auth before init', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    expect(() => sdk.auth).toThrow('SDK not initialized');
  });

  it('should initialize in client mode when projectSlug is provided', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    sdk.init({ projectSlug: 'test-project' });
    expect((sdk as any)._client).not.toBeNull();
    expect((sdk as any)._server).toBeNull();
  });

  it('should provide auth from client when initialized in client mode', () => {
    (sdk as any)._server = null;
    (sdk as any)._client = null;
    sdk.init({ projectSlug: 'test-project' });
    expect(sdk.auth).toBeDefined();
  });
});
