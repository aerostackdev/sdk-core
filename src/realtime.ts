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

export type RealtimeCallback<T = any> = (payload: RealtimePayload<T>) => void;

/** Typed payload for realtime events */
export interface RealtimePayload<T = any> {
    type: 'db_change' | 'chat_message';
    topic: string;
    operation: RealtimeEvent;
    data: T;
    old?: T;
    timestamp?: string;
    [key: string]: any;
}

export class RealtimeSubscription<T = any> {
    private client: RealtimeClient;
    private topic: string;
    private options: RealtimeSubscriptionOptions;
    private callbacks: Map<RealtimeEvent, Set<RealtimeCallback<T>>> = new Map();
    private isSubscribed: boolean = false;

    constructor(client: RealtimeClient, topic: string, options: RealtimeSubscriptionOptions = {}) {
        this.client = client;
        this.topic = topic;
        this.options = options;
    }

    on(event: RealtimeEvent, callback: RealtimeCallback<T>): this {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, new Set());
        }
        this.callbacks.get(event)!.add(callback);
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
    _emit(payload: RealtimePayload<T>): void {
        const event = payload.operation as RealtimeEvent;
        this.callbacks.get(event)?.forEach(cb => cb(payload));
        this.callbacks.get('*')?.forEach(cb => cb(payload));
    }
}

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RealtimeClientOptions {
    baseUrl: string;
    projectId: string;
    token?: string;
    userId?: string;
    apiKey?: string;
    /** Max reconnect attempts before giving up (default: Infinity) */
    maxReconnectAttempts?: number;
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
    private _sendQueue: any[] = [];
    private _connectingPromise: Promise<void> | null = null;
    private _status: RealtimeStatus = 'idle';
    private _statusListeners: Set<(s: RealtimeStatus) => void> = new Set();
    // B3: Pong tracking
    private _lastPong: number = 0;
    // A16: Max reconnect attempts
    private _maxReconnectAttempts: number;
    private _maxRetriesListeners: Set<() => void> = new Set();

    constructor(options: RealtimeClientOptions) {
        const wsBase = options.baseUrl.replace(/\/v1\/?$/, '').replace(/^http/, 'ws');
        this.baseUrl = `${wsBase}/api/realtime`;
        this.projectId = options.projectId;
        this.token = options.token;
        this.userId = options.userId;
        this.apiKey = options.apiKey;
        this._maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    }

    get status(): RealtimeStatus { return this._status; }

    /** Subscribe to connection status changes. Returns unsubscribe fn. */
    onStatusChange(cb: (status: RealtimeStatus) => void): () => void {
        this._statusListeners.add(cb);
        return () => this._statusListeners.delete(cb);
    }

    /** Called when max reconnect attempts exceeded. Returns unsubscribe fn. */
    onMaxRetriesExceeded(cb: () => void): () => void {
        this._maxRetriesListeners.add(cb);
        return () => this._maxRetriesListeners.delete(cb);
    }

    private _setStatus(s: RealtimeStatus) {
        this._status = s;
        this._statusListeners.forEach(cb => cb(s));
    }

    /** Update the auth token on a live connection (B4) */
    setToken(newToken: string): void {
        this.token = newToken;
        this._send({ type: 'auth', token: newToken });
    }

    connect(): Promise<void> {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
        if (this._connectingPromise) return this._connectingPromise;
        this._connectingPromise = this._doConnect().finally(() => {
            this._connectingPromise = null;
        });
        return this._connectingPromise;
    }

    private _doConnect(): Promise<void> {
        this._setStatus('connecting');
        return new Promise((resolve, reject) => {
            const url = new URL(this.baseUrl);
            // Always include projectId in URL for routing (not auth)
            url.searchParams.set('projectId', this.projectId);
            if (this.userId) url.searchParams.set('userId', this.userId);
            if (this.token) url.searchParams.set('token', this.token);

            // SECURITY: Pass API key via Sec-WebSocket-Protocol header, NOT as a URL query param.
            // URL query params appear in CDN logs, browser history, and Referer headers.
            // Protocol format: "aerostack-key.<base64-encoded-key>"
            const protocols: string[] = [];
            if (this.apiKey) {
                const encodedKey = typeof btoa !== 'undefined'
                    ? btoa(this.apiKey)
                    : Buffer.from(this.apiKey).toString('base64');
                protocols.push(`aerostack-key.${encodedKey}`);
            }

            this.ws = protocols.length > 0
                ? new WebSocket(url.toString(), protocols)
                : new WebSocket(url.toString());

            this.ws.onopen = () => {
                this._setStatus('connected');
                this.reconnectAttempts = 0;
                this._lastPong = Date.now();
                this.startHeartbeat();
                // B5: Listen for online/offline in browser
                this._setupOfflineDetection();
                // Flush queued messages
                while (this._sendQueue.length > 0) {
                    this.ws!.send(JSON.stringify(this._sendQueue.shift()));
                }
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
                this._setStatus('reconnecting');
                this.stopHeartbeat();
                this.ws = null;
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('Realtime connection error:', err);
                this._setStatus('disconnected');
                reject(err);
            };
        });
    }

    disconnect() {
        this._setStatus('disconnected');
        this.stopReconnect();
        this.stopHeartbeat();
        this._teardownOfflineDetection();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this._sendQueue = [];
    }

    channel<T = any>(topic: string, options: RealtimeSubscriptionOptions = {}): RealtimeSubscription<T> {
        const fullTopic = topic.includes('/') ? topic : `table/${topic}/${this.projectId}`;
        let sub = this.subscriptions.get(fullTopic);
        if (!sub) {
            sub = new RealtimeSubscription<T>(this, fullTopic, options);
            this.subscriptions.set(fullTopic, sub);
        }
        return sub as RealtimeSubscription<T>;
    }

    sendChat(roomId: string, text: string): void {
        this._send({ type: 'chat', roomId, text });
    }

    chatRoom(roomId: string): RealtimeSubscription {
        return this.channel(`chat/${roomId}/${this.projectId}`);
    }

    /** @internal */
    _send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this._sendQueue.push(data);
        }
    }

    private handleMessage(data: RealtimeMessage) {
        // B3: Track pong for liveness
        if (data.type === 'pong') {
            this._lastPong = Date.now();
            return;
        }
        if (data.type === 'db_change' || data.type === 'chat_message') {
            const sub = this.subscriptions.get(data.topic);
            if (sub) {
                sub._emit(data as any);
            }
        }
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this._send({ type: 'ping' });
            // B3: If no pong received in 70s (2+ missed heartbeats), force reconnect
            if (this._lastPong > 0 && Date.now() - this._lastPong > 70000) {
                console.warn('Realtime: no pong received, forcing reconnect');
                this.ws?.close();
            }
        }, 30000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private scheduleReconnect() {
        this.stopReconnect();
        // A16: Check max retries
        if (this.reconnectAttempts >= this._maxReconnectAttempts) {
            this._setStatus('disconnected');
            this._maxRetriesListeners.forEach(cb => cb());
            return;
        }
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        const jitter = delay * 0.3 * Math.random();
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => { });
        }, delay + jitter);
    }

    private stopReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    // B5: Offline/online detection (browser only)
    private _handleOnline = () => {
        if (this._status !== 'connected') {
            this.reconnectAttempts = 0; // Reset backoff
            this.connect().catch(() => { });
        }
    };

    private _handleOffline = () => {
        this.stopReconnect(); // Don't waste retries while offline
        this._setStatus('disconnected');
    };

    private _setupOfflineDetection() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', this._handleOnline);
            window.addEventListener('offline', this._handleOffline);
        }
    }

    private _teardownOfflineDetection() {
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this._handleOnline);
            window.removeEventListener('offline', this._handleOffline);
        }
    }
}
