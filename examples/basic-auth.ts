import { AerostackClient } from '@aerostack/sdk';

/**
 * Basic Authentication Example
 * 
 * Demonstrates how to use the Aerostack Client SDK for user authentication.
 * This pattern is suitable for:
 * - Frontend applications (React, Vue, Svelte, etc.)
 * - Mobile apps (React Native, Flutter)
 * - Node.js scripts
 */

// Initialize the Client SDK
// Note: In a browser, these would be import.meta.env.VITE_... or similar
const client = new AerostackClient({
    projectSlug: process.env.PROJECT_SLUG || 'demo-project',
    baseUrl: process.env.API_URL || 'https://api.aerostack.ai/v1',
    // apiKey: '...' // Only needed for admin operations or backend-to-backend calls
});

async function main() {
    const email = `user-${Date.now()}@example.com`;
    const password = 'Password123!';

    try {
        console.log('1. Registering new user...');
        const signupRes = await client.auth.register({
            email,
            password,
            name: 'Demo User'
        });
        console.log('✅ Registered:', signupRes.user?.id);

        console.log('\n2. Logging in...');
        const loginRes = await client.auth.login(email, password);
        console.log('✅ Logged in. Token:', loginRes.token?.substring(0, 20) + '...');

        if (loginRes.token) {
            console.log('\n3. Getting current user profile...');
            const user = await client.auth.getCurrentUser(loginRes.token);
            console.log('✅ User Profile:', user.email);
        }

    } catch (error: any) {
        console.error('❌ Error:', error.message);
    }
}

main();
