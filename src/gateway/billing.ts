/**
 * Gateway Billing — log usage for marketplace APIs (tokens, minutes, custom units).
 * Calls POST /v1/gateway/billing/log. Requires developer API key (X-Aerostack-Key).
 */

export interface GatewayBillingLogOptions {
    /** Developer API key (ac_secret_... or project API key). */
    apiKey: string;
    /** API base URL (default: https://api.aerostack.ai/v1). */
    baseUrl?: string;
    /** Consumer user ID (the end-user consuming your API). */
    consumerId: string;
    /** Gateway API ID (your published API id). */
    apiId: string;
    /** Metric name (default: 'units'). */
    metric?: string;
    /** Quantity to debit (e.g. tokens, minutes, requests). */
    units: number;
}

export interface GatewayBillingLogResult {
    success: boolean;
    loggedUnits: number;
}

/**
 * Log usage for a consumer of your gateway API. Debits the consumer's token wallet
 * and enqueues a billing event for Stripe metering. Use from any backend (Node, Worker, etc.).
 */
export async function logUsage(options: GatewayBillingLogOptions): Promise<GatewayBillingLogResult> {
    const baseUrl = (options.baseUrl || 'https://api.aerostack.ai/v1').replace(/\/$/, '');
    const url = `${baseUrl}/gateway/billing/log`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Aerostack-Key': options.apiKey,
        },
        body: JSON.stringify({
            consumerId: options.consumerId,
            apiId: options.apiId,
            metric: options.metric ?? 'units',
            units: options.units,
        }),
    });
    const data = (await res.json()) as { success?: boolean; loggedUnits?: number; message?: string; error?: string };
    if (!res.ok) {
        throw new Error(data.message || data.error || `Gateway billing log failed: ${res.status}`);
    }
    return { success: data.success === true, loggedUnits: data.loggedUnits ?? options.units };
}
