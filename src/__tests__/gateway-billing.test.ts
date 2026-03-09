import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logUsage } from '../gateway/billing';

describe('logUsage', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  it('should POST to the billing log endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, loggedUnits: 100 }),
    });

    await logUsage({
      apiKey: 'ac_secret_test',
      consumerId: 'consumer-1',
      apiId: 'api-1',
      units: 100,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.aerostack.dev/v1/gateway/billing/log');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers['X-Aerostack-Key']).toBe('ac_secret_test');
  });

  it('should send correct body with default metric', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, loggedUnits: 50 }),
    });

    await logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 50,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.consumerId).toBe('c1');
    expect(body.apiId).toBe('a1');
    expect(body.metric).toBe('units');
    expect(body.units).toBe(50);
  });

  it('should use custom metric when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, loggedUnits: 10 }),
    });

    await logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      metric: 'tokens',
      units: 10,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.metric).toBe('tokens');
  });

  it('should use custom baseUrl when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, loggedUnits: 10 }),
    });

    await logUsage({
      apiKey: 'key',
      baseUrl: 'https://custom.api.com/v1',
      consumerId: 'c1',
      apiId: 'a1',
      units: 10,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://custom.api.com/v1/gateway/billing/log');
  });

  it('should strip trailing slash from baseUrl', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await logUsage({
      apiKey: 'key',
      baseUrl: 'https://custom.api.com/v1/',
      consumerId: 'c1',
      apiId: 'a1',
      units: 10,
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://custom.api.com/v1/gateway/billing/log');
  });

  it('should return success and loggedUnits', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, loggedUnits: 42 }),
    });

    const result = await logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 42,
    });

    expect(result.success).toBe(true);
    expect(result.loggedUnits).toBe(42);
  });

  it('should fallback loggedUnits to input units when not returned', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 99,
    });

    expect(result.success).toBe(false);
    expect(result.loggedUnits).toBe(99);
  });

  it('should throw on non-OK response with message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Unauthorized' }),
    });

    await expect(logUsage({
      apiKey: 'bad-key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 10,
    })).rejects.toThrow('Unauthorized');
  });

  it('should throw on non-OK response with error field', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal error' }),
    });

    await expect(logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 10,
    })).rejects.toThrow('Internal error');
  });

  it('should throw generic message when no error details', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    await expect(logUsage({
      apiKey: 'key',
      consumerId: 'c1',
      apiId: 'a1',
      units: 10,
    })).rejects.toThrow('Gateway billing log failed: 403');
  });
});
