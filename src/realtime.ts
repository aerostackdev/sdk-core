export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*' | string;

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
    type: 'db_change' | 'chat_message' | 'event';
    topic: string;
    operation?: RealtimeEvent;
    event?: string;
    data: T;
    old?: T;
    userId?: string;
    timestamp?: number | string;
    [key: string]: any;
}

/** Chat history message returned from REST API */
export interface HistoryMessage {
    id: string;
    room_id: string;
    user_id: string;
    event: string;
    data: any;
    created_at: number;
}

export class RealtimeSubscription<T = any> {
    private client: RealtimeClient;
    topic: string;
    private options: RealtimeSubscriptionOptions;
    private callbacks: Map<string, Set<RealtimeCallback<T>>> = new Map();
    private isSubscribed: boolean = false;

    constructor(client: RealtimeClient, topic: string, options: RealtimeSubscriptionOptions = {}) {
        this.client = client;
        this.topic = topic;
        this.options = options;
    }

    /** Listen for DB change events (INSERT/UPDATE/DELETE/*) or custom named events */
    on(event: RealtimeEvent | string, callback: RealtimeCallback<T>): this {
        if (!this.callbacks.has(event)) {
            this.callbacks.set(event, new Set());
        }
        this.callbacks.get(event)!.add(callback);
        return this;
    }

    /** Remove a specific callback for an event */
    off(event: RealtimeEvent | string, callback: RealtimeCallback<T>): this {
        this.callbacks.get(event)?.delete(callback);
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
        this.client._removeSubscription(this.topic);
    }

    // ─── Phase 1: Pub/Sub — Publish custom events ─────────────────────────
    /** Publish a custom event to all subscribers on this channel */
    publish(event: string, data: any, options?: { persist?: boolean }): void {
        this.client._send({
            type: 'publish',
            topic: this.topic,
            event,
            data,
            persist: options?.persist,
            id: this.client._generateId(),
        });
    }

    // ─── Phase 2: Chat History ────────────────────────────────────────────
    /** Fetch persisted message history for this channel (requires persist: true on publish) */
    async getHistory(limit: number = 50, before?: number): Promise<HistoryMessage[]> {
        return this.client._fetchHistory(this.topic, limit, before);
    }

    // ─── Phase 3: Presence ────────────────────────────────────────────────
    /** Track this user's presence state on this channel (auto-synced to subscribers) */
    track(state: Record<string, any>): void {
        this.client._send({
            type: 'track',
            topic: this.topic,
            state,
        });
    }

    /** Stop tracking presence on this channel */
    untrack(): void {
        this.client._send({
            type: 'untrack',
            topic: this.topic,
        });
    }

    /** @internal */
    _emit(payload: RealtimePayload<T>): void {
        // DB change events (INSERT/UPDATE/DELETE)
        if (payload.operation) {
            const event = payload.operation as string;
            this.callbacks.get(event)?.forEach(cb => cb(payload));
        }
        // Custom named events ('player-moved', 'presence:join', etc.)
        if (payload.event) {
            this.callbacks.get(payload.event)?.forEach(cb => cb(payload));
        }
        // Catch-all
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
    // HTTP base URL for REST endpoints (history, etc.)
    private _httpBaseUrl: string;
    // Pong tracking
    private _lastPong: number = 0;
    // Max reconnect attempts
    private _maxReconnectAttempts: number;
    private _maxRetriesListeners: Set<() => void> = new Set();

    constructor(options: RealtimeClientOptions) {
        const wsBase = options.baseUrl.replace(/\/v1\/?$/, '').replace(/^http/, 'ws');
        this.baseUrl = `${wsBase}/api/realtime`;
        this._httpBaseUrl = options.baseUrl.replace(/\/v1\/?$/, '');
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

    /** Update the auth token on a live connection */
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
            url.searchParams.set('projectId', this.projectId);
            if (this.userId) url.searchParams.set('userId', this.userId);

            // SECURITY: Pass credentials via Sec-WebSocket-Protocol header — never as URL query params
            // (URL params appear in CDN logs, browser history, and Referer headers).
            const protocols: string[] = [];
            if (this.apiKey) protocols.push(`aerostack-key.${this.apiKey}`);
            if (this.token) protocols.push(`aerostack-token.${this.token}`);
            if (protocols.length > 0) protocols.push('aerostack-v1');

            this.ws = protocols.length > 0
                ? new WebSocket(url.toString(), protocols)
                : new WebSocket(url.toString());

            this.ws.onopen = () => {
                this._setStatus('connected');
                this.reconnectAttempts = 0;
                this._lastPong = Date.now();
                this.startHeartbeat();
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
        let fullTopic: string;
        if (!topic.includes('/')) {
            fullTopic = `table/${topic}/${this.projectId}`;
        } else if (this.projectId && topic.endsWith(`/${this.projectId}`)) {
            fullTopic = topic; // already fully qualified
        } else {
            fullTopic = `${topic}/${this.projectId}`; // e.g. 'table/orders' → 'table/orders/<projectId>'
        }
        let sub = this.subscriptions.get(fullTopic);
        if (!sub) {
            sub = new RealtimeSubscription<T>(this, fullTopic, options);
            this.subscriptions.set(fullTopic, sub);
        }
        return sub as RealtimeSubscription<T>;
    }

    /** Legacy: send a chat message (now persisted to DB) */
    sendChat(roomId: string, text: string, metadata?: Record<string, any>): void {
        this._send({ type: 'chat', roomId, text, metadata });
    }

    /** Legacy: get a chat room subscription */
    chatRoom(roomId: string): RealtimeSubscription {
        return this.channel(`chat/${roomId}/${this.projectId}`);
    }

    /** @internal — Generate unique message ID for ack tracking */
    _generateId(): string {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    /** @internal — Remove a subscription from the map (called on unsubscribe) */
    _removeSubscription(topic: string): void {
        this.subscriptions.delete(topic);
    }

    /** @internal */
    _send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this._sendQueue.push(data);
        }
    }

    /** @internal — Fetch chat/event history via REST API */
    async _fetchHistory(room: string, limit: number = 50, before?: number): Promise<HistoryMessage[]> {
        const url = new URL(`${this._httpBaseUrl}/api/v1/public/realtime/history`);
        url.searchParams.set('room', room);
        url.searchParams.set('limit', String(limit));
        if (before) url.searchParams.set('before', String(before));

        const headers: Record<string, string> = {};
        if (this.apiKey) headers['X-Aerostack-Key'] = this.apiKey;
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

        const res = await fetch(url.toString(), { headers });
        const json = await res.json() as any;
        return json.messages || [];
    }

    private handleMessage(data: RealtimeMessage) {
        // Track pong for liveness
        if (data.type === 'pong') {
            this._lastPong = Date.now();
            return;
        }

        // Ack (fire-and-forget acknowledgment from server)
        if (data.type === 'ack') {
            return;
        }

        // Route to subscription: db_change, chat_message, event, presence:*
        if (data.type === 'db_change' || data.type === 'chat_message' || data.type === 'event') {
            const sub = this.subscriptions.get(data.topic);
            if (sub) {
                sub._emit(data as any);
            }
        }

        // Re-key subscription on server-confirmed topic (for non-TS SDKs compatibility)
        if (data.type === 'subscribed' && data.topic) {
            for (const [origTopic, sub] of this.subscriptions.entries()) {
                if (data.topic !== origTopic && data.topic.startsWith(origTopic)) {
                    this.subscriptions.delete(origTopic);
                    sub.topic = data.topic;
                    this.subscriptions.set(data.topic, sub);
                    break;
                }
            }
        }
    }

    private startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this._send({ type: 'ping' });
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

    // Offline/online detection (browser only)
    private _handleOnline = () => {
        if (this._status !== 'connected') {
            this.reconnectAttempts = 0;
            this.connect().catch(() => { });
        }
    };

    private _handleOffline = () => {
        this.stopReconnect();
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
