export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeMessage {
    type: string;
    topic: string;
    [key: string]: any;
}

export interface RealtimeSubscriptionOptions {
    event?: RealtimeEvent;
    filter?: Record<string, any>;
}

export type RealtimeCallback = (payload: any) => void;

export class RealtimeSubscription {
    private client: RealtimeClient;
    private topic: string;
    private options: RealtimeSubscriptionOptions;
    private callbacks: Set<RealtimeCallback> = new Set();
    private isSubscribed: boolean = false;

    constructor(client: RealtimeClient, topic: string, options: RealtimeSubscriptionOptions = {}) {
        this.client = client;
        this.topic = topic;
        this.options = options;
    }

    on(event: RealtimeEvent, callback: RealtimeCallback): this {
        this.callbacks.add(callback);
        return this;
    }

    subscribe(): this {
        if (this.isSubscribed) return this;
        this.client._send({
            type: 'subscribe',
            topic: this.topic,
            filter: this.options.filter
        });
        this.isSubscribed = true;
        return this;
    }

    unsubscribe(): void {
        if (!this.isSubscribed) return;
        this.client._send({
            type: 'unsubscribe',
            topic: this.topic
        });
        this.isSubscribed = false;
        this.callbacks.clear();
    }

    /** @internal */
    _emit(payload: any): void {
        const event = payload.operation as RealtimeEvent;
        const requestedEvent = this.options.event || '*';

        if (requestedEvent === '*' || requestedEvent === event) {
            for (const cb of this.callbacks) {
                cb(payload);
            }
        }
    }
}

export class RealtimeClient {
    private baseUrl: string;
    private projectId: string;
    private token?: string;
    private userId?: string;
    private apiKey?: string;
    private ws: WebSocket | null = null;
    private subscriptions: Map<string, RealtimeSubscription> = new Map();
    private reconnectTimer: any = null;
    private heartbeatTimer: any = null;
    private reconnectAttempts: number = 0;

    constructor(options: { baseUrl: string; projectId: string; token?: string; userId?: string; apiKey?: string }) {
        this.baseUrl = options.baseUrl.replace(/^http/, 'ws') + '/realtime';
        this.projectId = options.projectId;
        this.token = options.token;
        this.userId = options.userId;
        this.apiKey = options.apiKey;
    }

    connect(): Promise<void> {
        if (this.ws) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            if (this.apiKey) {
                url.searchParams.set('apiKey', this.apiKey);
            } else {
                url.searchParams.set('projectId', this.projectId);
            }
            if (this.userId) url.searchParams.set('userId', this.userId);
            if (this.token) url.searchParams.set('token', this.token);

            this.ws = new WebSocket(url.toString());

            this.ws.onopen = () => {
                console.log('Aerostack Realtime Connected');
                this.reconnectAttempts = 0; // Reset backoff on success
                this.startHeartbeat();
                // Re-subscribe to existing topics if any
                for (const sub of this.subscriptions.values()) {
                    sub.subscribe();
                }
                resolve();
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (e) {
                    console.error('Realtime message parse error:', e);
                }
            };

            this.ws.onclose = () => {
                console.log('Aerostack Realtime Disconnected');
                this.stopHeartbeat();
                this.ws = null;
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('Realtime connection error:', err);
                reject(err);
            };
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        this.stopReconnect();
    }

    channel(topic: string, options: RealtimeSubscriptionOptions = {}): RealtimeSubscription {
        const fullTopic = topic.includes('/') ? topic : `table/${topic}/${this.projectId}`;

        let sub = this.subscriptions.get(fullTopic);
        if (!sub) {
            sub = new RealtimeSubscription(this, fullTopic, options);
            this.subscriptions.set(fullTopic, sub);
        }
        return sub;
    }

    /** @internal */
    _send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private handleMessage(data: RealtimeMessage) {
        if (data.type === 'db_change' || data.type === 'chat_message') {
            const sub = this.subscriptions.get(data.topic);
            if (sub) {
                sub._emit(data);
            }
        }
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this._send({ type: 'ping' });
        }, 30000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    /** Exponential backoff with jitter: 1s → 2s → 4s → ... → 30s */
    private scheduleReconnect() {
        this.stopReconnect();
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        const jitter = delay * 0.3 * Math.random();
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => { });
        }, delay + jitter);
    }

    private stopReconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    }
}
