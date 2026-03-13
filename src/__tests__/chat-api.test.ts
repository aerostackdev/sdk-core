import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AerostackClient, AerostackGatewayApi } from '../client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid' });

describe('AerostackClient.chatApi()', () => {
    let client: AerostackClient;

    beforeEach(() => {
        mockFetch.mockReset();
        client = new AerostackClient({ projectSlug: 'test-project' });
        client.gateway.setConsumerKey('ask_live_test123');
    });

    it('should return an AerostackGatewayApi instance', () => {
        const api = client.chatApi('my-chatbot');
        expect(api).toBeInstanceOf(AerostackGatewayApi);
    });

    it('should send non-streaming chat request', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Hello back!' } }],
                usage: { total_tokens: 42 },
            }),
        });

        const api = client.chatApi('my-chatbot');
        const result = await api.chat({ message: 'Hello' });

        expect(result.content).toBe('Hello back!');
        expect(result.tokensUsed).toBe(42);

        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/api/gateway/my-chatbot/v1/chat/completions');
        const body = JSON.parse(opts.body);
        expect(body.stream).toBe(false);
        expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('should include history in messages', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'Sure, here is more.' } }],
                usage: { total_tokens: 100 },
            }),
        });

        const api = client.chatApi('my-chatbot');
        await api.chat({
            message: 'Tell me more',
            history: [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there!' },
            ],
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.messages).toEqual([
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'Tell me more' },
        ]);
    });

    it('should handle streaming chat', async () => {
        const encoder = new TextEncoder();
        const chunks = [
            'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
            'data: {"choices":[],"usage":{"total_tokens":10}}\n\n',
            'data: [DONE]\n\n',
        ];

        let chunkIndex = 0;
        const mockReader = {
            read: vi.fn().mockImplementation(async () => {
                if (chunkIndex < chunks.length) {
                    return { done: false, value: encoder.encode(chunks[chunkIndex++]) };
                }
                return { done: true, value: undefined };
            }),
            cancel: vi.fn(),
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const tokens: string[] = [];
        let doneUsage: { tokensUsed: number } | null = null;

        const api = client.chatApi('my-chatbot');
        const result = await api.chat({
            message: 'Stream test',
            stream: true,
            onToken: (delta) => tokens.push(delta),
            onDone: (usage) => { doneUsage = usage; },
        });

        expect(tokens).toEqual(['Hello', ' world']);
        expect(result.content).toBe('Hello world');
        expect(result.tokensUsed).toBe(10);
        expect(doneUsage).toEqual({ tokensUsed: 10 });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.stream).toBe(true);
    });

    it('should pass model parameter', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                choices: [{ message: { content: 'response' } }],
                usage: { total_tokens: 5 },
            }),
        });

        const api = client.chatApi('my-chatbot');
        await api.chat({ message: 'Hi', model: 'gpt-4o' });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.model).toBe('gpt-4o');
    });

    it('should delegate usage() to gateway.usage()', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ total_tokens: 5000, total_requests: 100, days: 7 }),
        });

        const api = client.chatApi('my-chatbot');
        const usage = await api.usage(7);

        expect(usage.total_tokens).toBe(5000);
        const url = mockFetch.mock.calls[0][0];
        expect(url).toContain('api_slug=my-chatbot');
        expect(url).toContain('days=7');
    });

    it('should delegate wallet() to gateway.wallet()', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                wallet: { balance: 500, total_purchased: 1000, total_consumed: 500, plan_type: 'pro', hard_limit: null, soft_limit: null },
            }),
        });

        const api = client.chatApi('my-chatbot');
        const wallet = await api.wallet();

        expect(wallet.balance).toBe(500);
        const url = mockFetch.mock.calls[0][0];
        expect(url).toContain('api_slug=my-chatbot');
    });

    it('should throw on non-streaming error', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({ error: 'Unauthorized' }),
        });

        const api = client.chatApi('my-chatbot');
        await expect(api.chat({ message: 'Hi' })).rejects.toThrow('Unauthorized');
    });
});
