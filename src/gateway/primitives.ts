/**
 * Aerostack Router primitive
 * Allows developers to intercept and route arbitrary HTTP and WebSocket requests
 * within their gateway deployment.
 */
export class AerostackRouter {
    private httpHandlers: Array<(req: Request) => Response | Promise<Response>> = [];
    private wsMessageHandlers: Array<(ws: WebSocket, msg: string | ArrayBuffer) => void> = [];
    private wsConnectHandlers: Array<(ws: WebSocket) => void> = [];
    private wsDisconnectHandlers: Array<(ws: WebSocket) => void> = [];

    /**
     * Intercept standard HTTP requests
     */
    onRequest(handler: (req: Request) => Response | Promise<Response>): void {
        this.httpHandlers.push(handler);
    }

    /**
     * Intercept incoming WebSocket messages
     */
    onWebSocket(handler: (ws: WebSocket, msg: string | ArrayBuffer) => void): void {
        this.wsMessageHandlers.push(handler);
    }

    /**
     * Fired when a WebSocket client connects
     */
    onConnect(handler: (ws: WebSocket) => void): void {
        this.wsConnectHandlers.push(handler);
    }

    /**
     * Fired when a WebSocket client disconnects
     */
    onDisconnect(handler: (ws: WebSocket) => void): void {
        this.wsDisconnectHandlers.push(handler);
    }

    /**
     * Internal framework executor
     * @internal
     */
    async executeHttp(req: Request): Promise<Response | null> {
        for (const handler of this.httpHandlers) {
            const res = await handler(req);
            if (res) return res;
        }
        return null; // Fallthrough
    }

    /**
     * Run WebSocket lifecycle for a server-side WebSocket. Call this after accepting the WebSocket
     * (e.g. in a Worker fetch handler when request.headers.get('Upgrade') === 'websocket').
     * Fires onConnect, then wires message/close to onWebSocket/onDisconnect.
     */
    runWebSocket(server: WebSocket): void {
        for (const h of this.wsConnectHandlers) {
            h(server);
        }
        server.addEventListener('message', (e: MessageEvent) => {
            for (const h of this.wsMessageHandlers) {
                h(server, e.data as string | ArrayBuffer);
            }
        });
        server.addEventListener('close', () => {
            for (const h of this.wsDisconnectHandlers) {
                h(server);
            }
        });
    }
}

/**
 * Aerostack State primitive
 * Holds data in memory for long periods, powered by Cloudflare Durable Objects underneath.
 */
export class AerostackState {
    private storage: DurableObjectStorage | undefined;

    /** @internal */
    constructor(storage?: DurableObjectStorage) {
        this.storage = storage;
    }

    async get<T>(key: string): Promise<T | null> {
        if (!this.storage) throw new Error('State storage is not available in stateless context.');
        const val = await this.storage.get<T>(key);
        return val ?? null;
    }

    async set<T>(key: string, value: T): Promise<void> {
        if (!this.storage) throw new Error('State storage is not available in stateless context.');
        await this.storage.put(key, value);
    }

    async delete(key: string): Promise<void> {
        if (!this.storage) throw new Error('State storage is not available in stateless context.');
        await this.storage.delete(key);
    }

    async list(prefix?: string): Promise<Map<string, unknown>> {
        if (!this.storage) throw new Error('State storage is not available in stateless context.');
        return await this.storage.list({ prefix });
    }
}

/**
 * Aerostack Billing primitive
 * Emits usage log events that securely sync to the metering queue.
 */
export class AerostackBilling {
    /**
     * Logs custom units to the billing pipeline.
     */
    static async log(event: {
        consumerId: string;
        developerApiId: string;
        metric?: string; // Default: 'units'
        units: number;
    }): Promise<void> {
        // In a real execution environment, this dispatches via `env.BILLING_QUEUE`
        // Developer shouldn't handle that wiring though.
        const payload = {
            ...event,
            metric: event.metric || 'units',
            timestamp: Date.now()
        };

        // For local SDK logging before dispatch
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production') {
            console.log(`[Aerostack Billing] Billed ${payload.units} ${payload.metric} to consumer ${payload.consumerId}`);
        }

        // This will be intercepted in the Worker context by a global fetch/binding rewrite, or written to globalThis context vars
        if ((globalThis as any).__aerostack_billing_queue) {
            await (globalThis as any).__aerostack_billing_queue.send(payload);
        }
    }
}
