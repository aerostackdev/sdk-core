import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AerostackRouter, AerostackState, AerostackBilling } from '../gateway/primitives';

// ─── AerostackRouter ──────────────────────────────────────────

describe('AerostackRouter', () => {
  let router: AerostackRouter;

  beforeEach(() => {
    router = new AerostackRouter();
  });

  describe('HTTP handling', () => {
    it('should register and execute HTTP handlers', async () => {
      const handler = vi.fn().mockReturnValue(new Response('OK'));
      router.onRequest(handler);

      const req = new Request('https://example.com/test');
      const result = await router.executeHttp(req);

      expect(handler).toHaveBeenCalledWith(req);
      expect(result).toBeInstanceOf(Response);
    });

    it('should return null when no handlers match (fallthrough)', async () => {
      const handler = vi.fn().mockReturnValue(null);
      router.onRequest(handler);

      const result = await router.executeHttp(new Request('https://example.com'));
      expect(result).toBeNull();
    });

    it('should return null when no handlers registered', async () => {
      const result = await router.executeHttp(new Request('https://example.com'));
      expect(result).toBeNull();
    });

    it('should stop at first handler that returns a response', async () => {
      const handler1 = vi.fn().mockReturnValue(new Response('First'));
      const handler2 = vi.fn().mockReturnValue(new Response('Second'));
      router.onRequest(handler1);
      router.onRequest(handler2);

      const result = await router.executeHttp(new Request('https://example.com'));
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(await result!.text()).toBe('First');
    });

    it('should try next handler if first returns falsy', async () => {
      const handler1 = vi.fn().mockReturnValue(null);
      const handler2 = vi.fn().mockReturnValue(new Response('Second'));
      router.onRequest(handler1);
      router.onRequest(handler2);

      const result = await router.executeHttp(new Request('https://example.com'));
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(await result!.text()).toBe('Second');
    });

    it('should handle async handlers', async () => {
      const handler = vi.fn().mockResolvedValue(new Response('Async'));
      router.onRequest(handler);

      const result = await router.executeHttp(new Request('https://example.com'));
      expect(await result!.text()).toBe('Async');
    });
  });

  describe('WebSocket handling', () => {
    it('should register and fire onConnect handlers', () => {
      const handler = vi.fn();
      router.onConnect(handler);

      const mockWs = createMockWebSocket();
      router.runWebSocket(mockWs as any);

      expect(handler).toHaveBeenCalledWith(mockWs);
    });

    it('should register and fire onWebSocket message handlers', () => {
      const handler = vi.fn();
      router.onWebSocket(handler);

      const mockWs = createMockWebSocket();
      router.runWebSocket(mockWs as any);

      // Simulate message event
      const messageCallback = mockWs.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'message'
      )?.[1];
      expect(messageCallback).toBeDefined();
      messageCallback({ data: 'hello' });

      expect(handler).toHaveBeenCalledWith(mockWs, 'hello');
    });

    it('should register and fire onDisconnect handlers', () => {
      const handler = vi.fn();
      router.onDisconnect(handler);

      const mockWs = createMockWebSocket();
      router.runWebSocket(mockWs as any);

      // Simulate close event
      const closeCallback = mockWs.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'close'
      )?.[1];
      expect(closeCallback).toBeDefined();
      closeCallback();

      expect(handler).toHaveBeenCalledWith(mockWs);
    });

    it('should fire multiple connect handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      router.onConnect(h1);
      router.onConnect(h2);

      const mockWs = createMockWebSocket();
      router.runWebSocket(mockWs as any);

      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });

    it('should fire multiple message handlers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      router.onWebSocket(h1);
      router.onWebSocket(h2);

      const mockWs = createMockWebSocket();
      router.runWebSocket(mockWs as any);

      const messageCallback = mockWs.addEventListener.mock.calls.find(
        (c: any[]) => c[0] === 'message'
      )?.[1];
      messageCallback({ data: 'test' });

      expect(h1).toHaveBeenCalledWith(mockWs, 'test');
      expect(h2).toHaveBeenCalledWith(mockWs, 'test');
    });
  });
});

function createMockWebSocket() {
  return {
    addEventListener: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
  };
}

// ─── AerostackState ───────────────────────────────────────────

describe('AerostackState', () => {
  function createMockStorage() {
    const store = new Map<string, any>();
    return {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: any) => { store.set(key, value); }),
      delete: vi.fn(async (key: string) => { store.delete(key); }),
      list: vi.fn(async (opts?: { prefix?: string }) => {
        const result = new Map<string, unknown>();
        for (const [k, v] of store.entries()) {
          if (!opts?.prefix || k.startsWith(opts.prefix)) {
            result.set(k, v);
          }
        }
        return result;
      }),
      _store: store,
    };
  }

  it('should throw when get is called without storage', async () => {
    const state = new AerostackState();
    await expect(state.get('key')).rejects.toThrow('State storage is not available');
  });

  it('should throw when set is called without storage', async () => {
    const state = new AerostackState();
    await expect(state.set('key', 'val')).rejects.toThrow('State storage is not available');
  });

  it('should throw when delete is called without storage', async () => {
    const state = new AerostackState();
    await expect(state.delete('key')).rejects.toThrow('State storage is not available');
  });

  it('should throw when list is called without storage', async () => {
    const state = new AerostackState();
    await expect(state.list()).rejects.toThrow('State storage is not available');
  });

  it('should get a stored value', async () => {
    const storage = createMockStorage();
    storage._store.set('foo', 'bar');
    const state = new AerostackState(storage as any);

    const result = await state.get('foo');
    expect(result).toBe('bar');
  });

  it('should return null for missing key', async () => {
    const storage = createMockStorage();
    const state = new AerostackState(storage as any);

    const result = await state.get('missing');
    expect(result).toBeNull();
  });

  it('should set a value', async () => {
    const storage = createMockStorage();
    const state = new AerostackState(storage as any);

    await state.set('key', { data: 42 });
    expect(storage.put).toHaveBeenCalledWith('key', { data: 42 });
  });

  it('should delete a value', async () => {
    const storage = createMockStorage();
    const state = new AerostackState(storage as any);

    await state.delete('key');
    expect(storage.delete).toHaveBeenCalledWith('key');
  });

  it('should list values with prefix', async () => {
    const storage = createMockStorage();
    storage._store.set('user:1', 'alice');
    storage._store.set('user:2', 'bob');
    storage._store.set('session:1', 'abc');
    const state = new AerostackState(storage as any);

    const result = await state.list('user:');
    expect(result.size).toBe(2);
    expect(result.get('user:1')).toBe('alice');
  });

  it('should list all values without prefix', async () => {
    const storage = createMockStorage();
    storage._store.set('a', 1);
    storage._store.set('b', 2);
    const state = new AerostackState(storage as any);

    const result = await state.list();
    expect(result.size).toBe(2);
  });
});

// ─── AerostackBilling ─────────────────────────────────────────

describe('AerostackBilling', () => {
  beforeEach(() => {
    delete (globalThis as any).__aerostack_billing_queue;
  });

  it('should send to billing queue when available', async () => {
    const mockQueue = { send: vi.fn() };
    (globalThis as any).__aerostack_billing_queue = mockQueue;

    await AerostackBilling.log({
      consumerId: 'c1',
      developerApiId: 'api1',
      units: 100,
    });

    expect(mockQueue.send).toHaveBeenCalledOnce();
    const payload = mockQueue.send.mock.calls[0][0];
    expect(payload.consumerId).toBe('c1');
    expect(payload.developerApiId).toBe('api1');
    expect(payload.units).toBe(100);
    expect(payload.metric).toBe('units');
    expect(payload.timestamp).toBeTypeOf('number');
  });

  it('should use custom metric', async () => {
    const mockQueue = { send: vi.fn() };
    (globalThis as any).__aerostack_billing_queue = mockQueue;

    await AerostackBilling.log({
      consumerId: 'c1',
      developerApiId: 'api1',
      metric: 'tokens',
      units: 50,
    });

    const payload = mockQueue.send.mock.calls[0][0];
    expect(payload.metric).toBe('tokens');
  });

  it('should not throw when billing queue is not available', async () => {
    await expect(AerostackBilling.log({
      consumerId: 'c1',
      developerApiId: 'api1',
      units: 10,
    })).resolves.toBeUndefined();
  });
});
