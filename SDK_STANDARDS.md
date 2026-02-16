# Aerostack SDK Standards

This document defines the core architectural requirements for all official Aerostack SDKs (TypeScript, Node.js, Go, Python, Flutter, etc.). These standards ensure a consistent developer experience and enable "Smart SDK" features like deep resource introspection and type-safety.

## Core Requirements

### 1. API Key Support
All SDKs must support initialization with an `apiKey`.
- The `apiKey` should be passed in headers as `X-API-Key`.
- It replaces the need for an explicit `projectSlug` in most contexts, as the API identifies the project from the key.

### 2. Unified `call()` Method
Every SDK must provide a unified method for invoking custom Logic Lab modules (API hooks).
- **TypeScript/Node**: `client.call(slug, data, method)`
- **Go**: `client.Call(slug, data, method)`
- **Python**: `client.call(slug, data, method)`
- This method should be the primary way for developers to execute server-side logic defined in the Aerostack Console.

### 3. Project Schema Support (IntelliSense)
SDKs should be designed to support generated project-specific types.
- The `aerostack generate types` CLI command produces a schema definition.
- SDKs should accept this schema (usually as a generic/template parameter) to provide autocomplete for collections, custom API slugs, and payload structures.

## Synchronization Rule

> [!IMPORTANT]
> **Any architectural change made to the Core TypeScript SDK (`@aerostack/sdk`) must be synchronized across all official language SDKs.**
>
> AI and human contributors must verify that:
> 1. New features available in the Core SDK are implemented with idiomatic patterns in other languages.
> 2. Terminology and method naming remain consistent (e.g., using `call()` for custom modules everywhere).
> 3. Error handling patterns (Standardized `ClientError` codes) are mapped correctly in each language.

## Design Patterns

### Client-Side SDK
Focused on authentication, user profiles, and direct public API access.
- Pattern: `sdk.auth.register()`, `sdk.auth.login()`, `sdk.call()`.

### Server-Side SDK
Focused on administrative tasks, full database access, and secure resource management.
- Pattern: `sdk.db.collection('name').find()`, `sdk.queue.push()`, `sdk.cache.set()`.
