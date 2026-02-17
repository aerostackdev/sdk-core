# @aerostack/sdk

The official Aerostack SDK for building serverless applications with comprehensive backend features and authentication.

## Features

### 🔧 **Server SDK** - Full Backend Platform
Comprehensive server-side SDK for Cloudflare Workers with:
- **Multi-Database Operations**: D1 + Postgres with intelligent query routing
- **KV Cache**: High-performance edge caching
- **Queue**: Background job processing
- **R2 Storage**: File upload and management
- **AI Operations**: Chat completions, embeddings, text generation
- **Service Invocation**: Cross-service RPC via Workers Dispatch
- **Production-Ready Error Handling**: Structured errors with actionable suggestions

### 🔐 **Client SDK** - Authentication Excellence
Client-focused SDK with complete auth features:
- User registration and login
- OTP authentication
- Email verification
- Password reset flows
- Session management (refresh tokens)
- User profile management
- Comprehensive error handling

> **Note**: MFA and Social Auth coming in future releases

## Installation

```bash
npm install @aerostack/sdk
# or
pnpm add @aerostack/sdk
# or
yarn add @aerostack/sdk
```

## Quick Start

### Server SDK (Cloudflare Workers)

```typescript
import { AerostackServer } from '@aerostack/sdk';

export default {
  async fetch(request: Request, env: Env) {
    const aerostack = new AerostackServer(env);
    
    // Database query with intelligent routing
    const users = await aerostack.db.query('SELECT * FROM users WHERE active = ?', [true]);
    
    // Cache operations
    await aerostack.cache.set('user:123', { name: 'John' }, { ttl: 3600 });
    const user = await aerostack.cache.get('user:123');
    
    // Queue background job
    await aerostack.queue.enqueue({
      type: 'send-email',
      data: { to: 'user@example.com', subject: 'Welcome!' }
    });
    
    // AI chat completion
    const response = await aerostack.ai.chat([
      { role: 'user', content: 'Hello!' }
    ]);
    
    return new Response(JSON.stringify(users));
  }
};
```

### Client SDK (Frontend)

```typescript
import { AerostackClient } from '@aerostack/sdk';

const client = new AerostackClient({
  projectSlug: 'my-project',
  baseUrl: 'https://api.aerostack.dev' // optional
});

// Register user
try {
  const { user, token } = await client.auth.register({
    email: 'user@example.com',
    password: 'secure-password',
    name: 'John Doe'
  });
  console.log('Registered:', user);
} catch (error) {
  if (error.code === 'AUTH_USER_EXISTS') {
    console.log(error.details.suggestion); // "Try logging in instead"
  }
}

// Login
const { user, token } = await client.auth.login('user@example.com', 'password');

// OTP authentication
await client.auth.sendOTP('user@example.com');
const auth = await client.auth.verifyOTP('user@example.com', '123456');

// Password reset
await client.auth.requestPasswordReset('user@example.com');
await client.auth.resetPassword('reset-token', 'new-password');

// Session management
const newToken = await client.auth.refreshToken(refreshToken);
await client.auth.logout(token);

// User profile
const currentUser = await client.auth.getCurrentUser(token);
const updated = await client.auth.updateProfile(token, { name: 'Jane Doe' });
```

## Server SDK API

### Database Operations

```typescript
// Query with intelligent routing (D1 or Postgres)
const result = await aerostack.db.query<User>('SELECT * FROM users WHERE id = ?', [123]);

// Get schema information
const schema = await aerostack.db.getSchema();

// Batch queries
const results = await aerostack.db.batch([
  { sql: 'INSERT INTO users ...', params: [...] },
  { sql: 'UPDATE posts ...', params: [...] }
]);
```

### Cache Operations

```typescript
// Set with TTL
await aerostack.cache.set('key', { data: 'value' }, { ttl: 3600 });

// Get
const value = await aerostack.cache.get('key');

// Delete
await aerostack.cache.delete('key');

// Check existence
const exists = await aerostack.cache.exists('key');
```

### Queue Operations

```typescript
// Enqueue job
const job = await aerostack.queue.enqueue({
  type: 'send-email',
  data: { to: 'user@example.com' },
  delay: 60 // seconds
});

console.log(job.jobId); // 'job_...'
```

### Storage Operations

```typescript
// Upload file
const result = await aerostack.storage.upload(
  fileBuffer,
  'uploads/avatar.jpg',
  { contentType: 'image/jpeg' }
);

// Get URL
const url = await aerostack.storage.getUrl('uploads/avatar.jpg');

// Delete
await aerostack.storage.delete('uploads/avatar.jpg');

// List files
const files = await aerostack.storage.list('uploads/');
```

### AI Operations

```typescript
// Chat completion
const chat = await aerostack.ai.chat([
  { role: 'system', content: 'You are a helpful assistant' },
  { role: 'user', content: 'Hello!' }
], { temperature: 0.7 });

// Text embeddings
const embedding = await aerostack.ai.embed('Text to embed');

// Text generation
const generated = await aerostack.ai.generate('Write a story about...');
```

### Service Invocation

```typescript
// Invoke another service
const result = await aerostack.services.invoke('billing-service', {
  action: 'process-payment',
  amount: 1000
});
```

## Backend Wrapper Pattern

**Use Case**: Building a backend service that needs **both** Auth/API features (Client SDK) and direct DB/Queue access (Server SDK).

The global `sdk.init()` singleton can only operate in one mode at a time. For backend wrappers, **use direct instantiation**:

### Dual-Mode Pattern

```typescript
import { AerostackClient, AerostackServer } from '@aerostack/sdk';

export default {
  async fetch(request: Request, env: Env) {
    // Initialize both SDKs
    const client = new AerostackClient({
      projectSlug: "my-project",
      // apiKey: env.ADMIN_API_KEY, // Optional: Admin privileges
      baseUrl: env.API_URL || 'https://api.aerostack.dev'
    });

    const server = new AerostackServer(env);

    // Example: Custom registration with organization setup
    if (request.url.includes('/register-with-org')) {
      const { email, password, companyName } = await request.json();

      // 1. Register user via Client SDK (handles hashing, tokens)
      const { user, token } = await client.auth.register({
        email,
        password,
        name: companyName
      });

      // 2. Create organization via Server SDK
      await server.db.query(
        'INSERT INTO organizations (name, owner_id) VALUES (?, ?)',
        [companyName, user.id]
      );

      // 3. Send welcome email via Queue
      await server.queue.enqueue({
        type: 'send-email',
        data: { to: email, template: 'welcome' }
      });

      return Response.json({ user, token });
    }

    // ... more endpoints
  }
};
```

### When to Use This Pattern

✅ **Use dual-mode when**:
- Building API wrappers around Aerostack's Auth/E-commerce
- Adding custom business logic to Auth flows
- Combining public API calls with direct DB operations
- Creating admin endpoints that need both Auth verification and DB access

❌ **Don't use dual-mode when**:
- You only need Auth (use `AerostackClient` alone)
- You only need DB/Queue (use `AerostackServer` alone)
- Building a pure frontend application (use `AerostackClient`)

See [examples/backend-wrapper.ts](./examples/backend-wrapper.ts) for complete working examples.

## Error Handling

Both SDKs provide structured error handling with actionable suggestions:

### Server SDK Errors

```typescript
import { DatabaseError, CacheError, AIError } from '@aerostack/sdk';

try {
  await aerostack.db.query('SELECT * FROM users');
} catch (error) {
  if (error instanceof DatabaseError) {
    console.log(error.code);        // 'DB_TABLE_NOT_FOUND'
    console.log(error.message);     // 'Table does not exist: users'
    console.log(error.details.suggestion); // 'Run migrations first'
    console.log(error.details.recoveryAction); // 'CREATE_TABLE'
  }
}
```

### Client SDK Errors

```typescript
import { ClientError, AuthenticationError, ValidationError } from '@aerostack/sdk';

try {
  await client.auth.login('user@example.com', 'wrong-password');
} catch (error) {
  if (error instanceof ClientError) {
    console.log(error.code);        // 'AUTH_INVALID_CREDENTIALS'
    console.log(error.message);     // 'Invalid credentials'
    console.log(error.details.suggestion); // 'Double-check your email and password'
    console.log(error.statusCode);  // 401
    
    // Helper methods
    if (error.isAuthError()) {
      // Handle auth errors
    }
  }
}
```

## Configuration

### Server SDK Environment

The Server SDK automatically detects the following from your environment:

```toml
# aerostack.toml
[[d1_databases]]
binding = "DB"
database_name = "my-database"

[[postgres_databases]]
binding = "POSTGRES"
connection_string = "$NEON_DATABASE_URL"

[[kv_namespaces]]
binding = "CACHE"
id = "..."

[[queues]]
binding = "QUEUE"
queue_name = "background-jobs"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "my-bucket"
```

### Client SDK Configuration

```typescript
const client = new AerostackClient({
  projectSlug: 'my-project',        // Required
  baseUrl: 'https://api.aerostack.dev' // Optional, defaults to production
});
```

## TypeScript Support

Both SDKs are written in TypeScript with full type definitions:

```typescript
import type {
  DatabaseResponse,
  SchemaInfo,
  User,
  AuthResponse,
  ChatResponse,
  UploadResult
} from '@aerostack/sdk';

// Type-safe database queries
const users = await aerostack.db.query<User>('SELECT * FROM users');
users.results[0].email; // ✅ TypeScript knows this is a User[]

// Type-safe auth responses
const auth = await client.auth.login('...', '...');
auth.user.emailVerified; // ✅ TypeScript knows the shape
```

## Examples

See the [examples directory](./examples) for complete working examples:
- [Server SDK - Full Feature Demo](./examples/server-sdk-demo.ts)
- [Client SDK - Auth Flows](./examples/client-sdk-demo.ts)
- [Error Handling Patterns](./examples/error-handling.ts)

## Contributing

Contributions are welcome! Please read our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT © Aerostack Team
