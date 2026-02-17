# Aerostack Core SDK Examples

Examples for `@aerostack/sdk` (TypeScript).

## Prerequisites

```bash
npm install @aerostack/sdk
```

## Available Examples

| Example | Description | Environment |
|---------|-------------|-------------|
| [**Basic Auth**](./basic-auth.ts) | Signup, Login, Get Profile using Client SDK. | Any (Node, Browser) |
| [**Backend Wrapper**](./backend-wrapper.ts) | **Standard Pattern**: Dual-mode usage of Client (Auth) + Server (DB) in one Worker. | Cloudflare Workers |
| [**Database Only**](./database-only.ts) | Direct database access using Server SDK bindings. | Cloudflare Workers |

## Usage

### Running Basic Auth (Node.js)

```bash
# Set environment variables
export PROJECT_SLUG=your-project-slug
export API_URL=https://api.aerostack.ai/v1

# Run with ts-node
npx ts-node examples/basic-auth.ts
```

### Deploying Worker Examples

Copy the code from `backend-wrapper.ts` or `database-only.ts` into your Worker's `src/index.ts`.
