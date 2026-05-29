# Spoosh Plugins API Reference

## Plugin Installation

```bash
# Core plugins
pnpm add @spoosh/plugin-cache
pnpm add @spoosh/plugin-retry
pnpm add @spoosh/plugin-polling
pnpm add @spoosh/plugin-debounce
pnpm add @spoosh/plugin-throttle
pnpm add @spoosh/plugin-deduplication
pnpm add @spoosh/plugin-invalidation
pnpm add @spoosh/plugin-optimistic
pnpm add @spoosh/plugin-initial-data
pnpm add @spoosh/plugin-refetch
pnpm add @spoosh/plugin-prefetch
pnpm add @spoosh/plugin-transform
pnpm add @spoosh/plugin-gc
pnpm add @spoosh/plugin-qs
pnpm add @spoosh/plugin-progress
pnpm add @spoosh/plugin-debug
pnpm add @spoosh/plugin-nextjs
```

## Accessing Plugin Instance APIs

Plugin instance APIs are returned from `create()`, NOT from the Spoosh instance:

```typescript
import { Spoosh } from "@spoosh/core";
import { create } from "@spoosh/react";
import { cachePlugin } from "@spoosh/plugin-cache";
import { invalidationPlugin } from "@spoosh/plugin-invalidation";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([cachePlugin(), invalidationPlugin()]);

// Instance APIs come from create(), not from spoosh
const { useRead, useWrite, usePages, clearCache, invalidate } = create(spoosh);

// Now you can use instance APIs directly
clearCache();
invalidate(["users"]);
```

## Cache Plugin

Caches responses with configurable stale time.

**Plugin Config:**
```typescript
cachePlugin({
  staleTime?: number;  // Default stale time in ms. Defaults to 0.
})
```

**Per-Request Options (read operations):**
```typescript
useRead((api) => api("users").GET(), {
  staleTime: 60000  // Override stale time for this request
});
```

**Write Options:**
```typescript
const { trigger } = useWrite((api) => api("users").POST());
await trigger({
  body: data,
  clearCache: true  // Clear all cached data after mutation
});
```

**Instance API:**
```typescript
const { clearCache } = create(spoosh);

clearCache();                          // Clear all cache
clearCache({ refetchAll: true });      // Clear and refetch active queries
```

## Retry Plugin

Automatic retry with exponential backoff.

**Plugin Config:**
```typescript
retryPlugin({
  retries?: number | false;     // Number of retry attempts. Defaults to 3.
  delay?: number;               // Delay between retries in ms. Defaults to 1000.
  shouldRetry?: ShouldRetryCallback;  // Custom retry logic
})
```

**ShouldRetryCallback:**
```typescript
type ShouldRetryCallback = (context: ShouldRetryContext) => boolean;

interface ShouldRetryContext {
  status?: number;     // HTTP status code
  error: unknown;      // The error that occurred
  attempt: number;     // Current attempt (0-indexed)
  maxRetries: number;  // Max retries configured
}
```

**Default Behavior:**
- Retries on status codes: 408, 429, 500, 502, 503, 504
- Network errors (TypeError) are ALWAYS retried regardless of shouldRetry
- Abort errors are NEVER retried
- Uses exponential backoff: `delay * 2^attempt`

**Per-Request Options:**
```typescript
useRead((api) => api("users").GET(), {
  retry: {
    retries: 5,
    delay: 2000,
    shouldRetry: ({ status, attempt }) => {
      if (status === 401) return false;  // Don't retry auth errors
      return status !== undefined && status >= 500;
    }
  }
});

// Disable retries
useRead((api) => api("users").GET(), { retry: { retries: false } });
```

## Polling Plugin

Auto-refresh at intervals.

```typescript
import { pollingPlugin } from "@spoosh/plugin-polling";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([pollingPlugin()]);

// Static interval
useRead((api) => api("status").GET(), { pollingInterval: 5000 });

// Dynamic interval based on response (destructured context)
useRead((api) => api("jobs/:id").GET({ params: { id } }), {
  pollingInterval: ({ data, error }) => {
    if (error) return false;
    if (data?.status === "complete") return false;
    return 2000;
  }
});
```

**Read Result Properties:**
- `meta.isPollingRequest: boolean` - `true` when a polling-triggered request is currently in progress (useful to suppress loading spinners during background refreshes)

## Debounce Plugin

Debounce requests (useful for search inputs).

```typescript
import { debouncePlugin } from "@spoosh/plugin-debounce";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([debouncePlugin()]);

useRead(
  (api) => api("search").GET({ query: { q: searchTerm } }),
  { debounce: 300, enabled: searchTerm.length > 0 }
);
```

## Throttle Plugin

Rate-limit requests.

```typescript
import { throttlePlugin } from "@spoosh/plugin-throttle";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([throttlePlugin()]);

useRead((api) => api("expensive").GET(), { throttle: 1000 });
```

## Deduplication Plugin

Prevent duplicate in-flight requests.

```typescript
import { deduplicationPlugin } from "@spoosh/plugin-deduplication";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([deduplicationPlugin()]);

// Multiple components calling same endpoint share the same request
// Automatic - no configuration needed
```

## Invalidation Plugin

Auto-invalidate cache after mutations using wildcard pattern matching.

**IMPORTANT: Tags and invalidation are handled automatically!** You rarely need to configure them manually.

**Plugin Config:**
```typescript
invalidationPlugin({
  autoInvalidate?: boolean;  // Default: true - auto-generate patterns from path
  groups?: string[];         // Path prefixes for deeper segment matching (e.g., ["admin", "api/v1"])
})
```

**Tag Generation (automatic from resolved path):**
- `api("users").GET()` → tag: `"users"`
- `api("users/:id").GET({ params: { id: "123" } })` → tag: `"users/123"`
- `api("users/:id/posts").GET(...)` → tag: `"users/123/posts"`

**Custom Tags (when auto-generated doesn't fit):**
```typescript
// Custom tag only - replaces auto-generated
useRead((api) => api("users").GET(), { tags: "dashboard-users" });

// Default path + custom (recommended for cross-cutting concerns)
useRead((api) => api("stats").GET(), {
  tags: ["stats", "sidebar-stats"],  // Keep "stats" + add custom
});

// Then invalidate by either path or custom tag
await trigger({ body: data, invalidate: "stats" });         // Auto still works
await trigger({ body: data, invalidate: "sidebar-stats" }); // Custom tag
```

**Auto-Invalidation (default behavior):**
```typescript
// POST users/123 → auto-invalidates ["users", "users/*"]
// This matches: "users", "users/1", "users/123/comments", etc.
await trigger({ body: data });  // No need to specify invalidate!
```

**Groups Config (for namespaced APIs):**
```typescript
invalidationPlugin({
  groups: ["admin", "api/v1"],
});

// Without groups: POST admin/posts → invalidates ["admin", "admin/*"]
// With groups:    POST admin/posts → invalidates ["admin/posts", "admin/posts/*"]
```

**Pattern Matching:**
| Pattern | Matches | Does NOT Match |
|---------|---------|----------------|
| `"posts"` | `"posts"` (exact) | `"posts/1"` |
| `"posts/*"` | `"posts/1"`, `"posts/1/comments"` | `"posts"` |
| `["posts", "posts/*"]` | `"posts"` AND all children | - |

**Write Options (only when overriding defaults):**
```typescript
const { trigger } = useWrite((api) => api("users").POST());

// Override auto-invalidation when needed:
await trigger({ body: data, invalidate: "posts" });           // Exact match only
await trigger({ body: data, invalidate: "posts/*" });         // Children only
await trigger({ body: data, invalidate: ["posts", "users"] }); // Multiple patterns
await trigger({ body: data, invalidate: false });              // Disable invalidation
await trigger({ body: data, invalidate: "*" });                // Global refetch all
```

**Instance API:**
```typescript
const { invalidate } = create(spoosh);

invalidate("users");              // Single pattern
invalidate("users/*");            // Wildcard pattern
invalidate(["users", "posts/*"]); // Multiple patterns
invalidate("*");                  // Global refetch all
```

## Optimistic Plugin

Instant UI updates with automatic rollback using a fluent API.

```typescript
import { optimisticPlugin } from "@spoosh/plugin-optimistic";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([optimisticPlugin()]);

const { trigger } = useWrite((api) => api("posts/:id").PUT());

// Immediate update (default) - applied before mutation completes
// Use template literal for dynamic params
await trigger({
  params: { id: postId },
  body: { title: "New Title" },
  optimistic: (cache) => cache(`posts/${postId}`)
    .set((current) => ({ ...current, title: "New Title" }))
});

// Or use filter with params
await trigger({
  params: { id: postId },
  body: { title: "New Title" },
  optimistic: (cache) => cache("posts/:id")
    .filter((entry) => entry.params.id === postId)
    .set((current) => ({ ...current, title: "New Title" }))
});

// With filter predicate (by query)
await trigger({
  body: newPost,
  optimistic: (cache) => cache("posts")
    .filter((entry) => entry.query.page === 1)
    .set((posts) => [newPost, ...posts])
});

// Apply after mutation succeeds (receives response)
await trigger({
  body: postData,
  optimistic: (cache) => cache("posts")
    .confirmed()
    .set((posts, newPost) => [...posts, newPost])
});

// Multiple targets
await trigger({
  params: { id },
  optimistic: (cache) => [
    cache("posts").set((posts) => posts.filter((p) => p.id !== id)),
    cache("stats").set((stats) => ({ ...stats, count: stats.count - 1 }))
  ]
});
```

**Fluent API Methods:**
- `cache("path")` - Select cache entries for this path
  - Use template literals for dynamic params: `` cache(`posts/${id}`) ``
  - Or use filter: `cache("posts/:id").filter((entry) => entry.params.id === id)`
- `.filter(predicate)` - Filter cache entries by params/query
  - `(entry) => entry.params.id === id` - Match by param
  - `(entry) => entry.query.page === 1` - Match by query
- `.set(fn)` - Update function (required)
- `.confirmed()` - Apply after mutation succeeds (response available in set)
- `.disableRollback()` - Disable automatic rollback on error
- `.onError(fn)` - Callback when mutation fails

**Standalone Usage (External Events):**

Use the `optimistic` function from `create()` directly for external events like WebSocket messages — no mutation needed:

```typescript
const { optimistic } = create(spoosh);

// Update cache from WebSocket events
ws.on("message", (data) => {
  if (data.type === "NEW_POST") {
    optimistic((cache) => cache("posts").set((posts) => [...posts, data.post]));
  }
});

// With filter
optimistic((cache) =>
  cache("posts/:id")
    .filter((entry) => entry.params.id === targetId)
    .set((post) => ({ ...post, title: "updated" }))
);

// Multiple targets
optimistic((cache) => [
  cache("posts").set((posts) => [...posts, newPost]),
  cache("stats").set((stats) => ({ ...stats, count: stats.count + 1 }))
]);
```

> **Note:** Standalone mode only supports immediate updates (`filter` and `set`). Methods `confirmed()`, `disableRollback()`, and `onError()` are not available since there is no mutation lifecycle.

**Read Result Properties:**
- `meta.isOptimistic: boolean` - True if data is from an optimistic update (not yet confirmed by server)

## Initial Data Plugin

Show data immediately before fetch completes.

```typescript
import { initialDataPlugin } from "@spoosh/plugin-initial-data";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([initialDataPlugin()]);

// Static initial data
useRead((api) => api("users").GET(), {
  initialData: []
});

// Dynamic initial data
useRead((api) => api("user/:id").GET({ params: { id } }), {
  initialData: () => cachedUsers.find(u => u.id === id)
});

// Disable background refetch (show initial data only)
useRead((api) => api("users").GET(), {
  initialData: cachedData,
  refetchOnInitialData: false  // Default: true
});
```

**Per-Request Options:**
- `initialData?: TData | (() => TData)` - Data to show immediately
- `refetchOnInitialData?: boolean` - Refetch fresh data after showing initial data (default: true)

**Result Properties:**
- `meta.isInitialData: boolean` - True if currently showing initial data (not yet fetched from server)

## Refetch Plugin

Refetch on window focus or network reconnect.

```typescript
import { refetchPlugin } from "@spoosh/plugin-refetch";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([refetchPlugin({
    onFocus: true,
    onReconnect: true
  })]);

// Per-request override
useRead((api) => api("users").GET(), {
  refetch: { onFocus: false }
});
```

## Prefetch Plugin

Preload data before it's needed.

```typescript
import { prefetchPlugin } from "@spoosh/plugin-prefetch";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([prefetchPlugin({
    timeout: 30000  // Timeout in ms after which stale promises are cleared. Default: 30000
  })]);

// Get prefetch from create()
const { prefetch } = create(spoosh);

// Prefetch on hover
<button onMouseEnter={() => prefetch((api) => api("user/:id").GET({ params: { id } }))}>
  View User
</button>
```

## Transform Plugin

Transform response data.

```typescript
import { transformPlugin } from "@spoosh/plugin-transform";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([transformPlugin()]);

// Sync transform
useRead((api) => api("users").GET(), {
  transform: (users) => users.filter(u => u.active)
});

// Async transform
useRead((api) => api("data").GET(), {
  transform: async (data) => {
    const enriched = await enrichData(data);
    return enriched;
  }
});

// Transform on write (with hook-level option)
const { trigger, meta } = useWrite((api) => api("posts").POST(), {
  transform: (post) => ({ ...post, createdAt: new Date(post.timestamp) })
});

await trigger({ body: postData });
console.log(meta.transformedData);  // Transformed response available here
```

**Result Properties:**
- `meta.transformedData: TTransformed | undefined` - The transformed response data (available after request completes)

## GC Plugin

Garbage collection for cache entries.

**Plugin Config:**
```typescript
import { gcPlugin } from "@spoosh/plugin-gc";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([gcPlugin({
    maxAge: 300000,      // Max age in ms before entries are removed
    maxEntries: 100,     // Max number of cache entries to keep
    interval: 60000      // Interval between GC runs (default: 60000)
  })]);
```

**Instance API:**
```typescript
const { runGc } = create(spoosh);

// Manually trigger garbage collection
const removedCount = runGc();
```

**Note:** GC plugin has NO per-request options. Configure at plugin level only.

## Query String Plugin

Custom query string serialization using [qs](https://github.com/ljharb/qs) library options.

**Plugin Config:**
```typescript
import { qsPlugin } from "@spoosh/plugin-qs";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([qsPlugin({
    arrayFormat: "brackets",  // "brackets" | "indices" | "repeat" | "comma"
    allowDots: false,         // Enable dot notation: a.b=c
    skipNulls: true           // Skip null values
  })]);
```

**Per-Request Options:**
```typescript
useRead((api) => api("search").GET({ query: { filters: { status: "active" } } }), {
  qs: { arrayFormat: "indices" }  // Override for this request
});
```

**Example:**
```typescript
// Query: { filters: { status: "active", tags: ["a", "b"] } }
// With arrayFormat: "brackets" → filters[status]=active&filters[tags][]=a&filters[tags][]=b
```

## Progress Plugin

Track upload/download progress. Progress tracking must be explicitly enabled with `{ progress: true }`.

**Important:** Progress only contains `loaded` and `total` - there is no `percentage` property. Calculate it manually.

```typescript
import { progressPlugin } from "@spoosh/plugin-progress";
import { form } from "@spoosh/core";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([progressPlugin()]);

// Download with progress - must enable with progress option
const { meta, loading } = useRead(
  (api) => api("large-file").GET(),
  { progress: { totalHeader: "x-content-length" } }  // Enable progress tracking
);

// Types flow automatically - no casting needed
const percentage = meta.progress?.total && meta.progress.total > 0
  ? Math.round((meta.progress.loaded / meta.progress.total) * 100)
  : 0;

// Upload with progress
const { trigger, meta: writeMeta, loading: uploading } = useWrite(
  (api) => api("upload").POST()
);

// Enable progress in trigger options
await trigger({
  body: form({ file: myFile }),  // Use form() for file uploads
  progress: true
});

// Types flow automatically from plugins
const uploadPercentage = writeMeta.progress?.total && writeMeta.progress.total > 0
  ? Math.round((writeMeta.progress.loaded / writeMeta.progress.total) * 100)
  : 0;
```

**Progress Options:**
- `progress: true` - Enable progress tracking (forces XHR transport)
- `progress: { totalHeader: "x-custom-header" }` - Use custom header for total size when Content-Length unavailable

## Debug Plugin

Debugging utilities.

```typescript
import { debugPlugin } from "@spoosh/plugin-debug";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([debugPlugin({ enabled: process.env.NODE_ENV === "development" })]);
```

## Next.js Plugin

Server-side cache revalidation for Next.js App Router.

**Step 1: Create a Server Action file:**
```typescript
// app/actions/revalidate.ts
"use server";

import { revalidatePath, revalidateTag } from "next/cache";

export async function revalidateCache(tags: string[], paths: string[]) {
  for (const tag of tags) {
    revalidateTag(tag);
  }
  for (const path of paths) {
    revalidatePath(path);
  }
}
```

**Step 2: Configure the plugin:**
```typescript
// lib/spoosh.ts
import { nextjsPlugin } from "@spoosh/plugin-nextjs";
import { revalidateCache } from "@/app/actions/revalidate";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([nextjsPlugin({
    serverRevalidator: revalidateCache,
    skipServerRevalidation: false  // Default: false
  })]);
```

**Trigger Options:**
```typescript
await trigger({
  body: data,
  nextjs: {
    revalidatePaths: ["/users", "/dashboard"],  // Additional paths to revalidate
    serverRevalidate: true                       // Override plugin default
  }
});
```
