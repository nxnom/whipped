# Spoosh React Hooks API Reference

## useRead

### Complete Signature

```typescript
function useRead<TData, TError, TTransformed = TData>(
  requestFn: (api: SpooshApi) => RequestConfig<TData>,
  options?: UseReadOptions<TData, TError, TTransformed>
): UseReadResult<TData, TError, TMeta>;
```

### Core Options

```typescript
type BaseReadOptions = {
  /** Whether to fetch automatically on mount. Default: true */
  enabled?: boolean;

  /**
   * Unified tag option
   * - String: mode only ('all' | 'self' | 'none')
   * - Array: custom tags only OR [mode keyword mixed with custom tags]
   */
  tags?: TagMode | (TagModeInArray | (string & {}))[];
};
```

### Plugin Options (require corresponding plugins)

```typescript
// These options are ONLY available when the corresponding plugin is installed

// Cache plugin (@spoosh/plugin-cache)
staleTime?: number;

// Retry plugin (@spoosh/plugin-retry)
retry?: {
  retries?: number | false;
  delay?: number;
  shouldRetry?: (context: ShouldRetryContext) => boolean;
};
// ShouldRetryContext: { status?: number; error: unknown; attempt: number; maxRetries: number }

// Polling plugin (@spoosh/plugin-polling)
pollingInterval?: number | (({ data, error }: { data: TData | undefined, error: TError | undefined }) => number | false);

// Debounce plugin (@spoosh/plugin-debounce)
debounce?: number | ((prevRequest: TRequest) => number);

// Transform plugin (@spoosh/plugin-transform)
transform?: (data: TData) => TTransformed;

// Initial data plugin (@spoosh/plugin-initial-data)
initialData?: TData | (() => TData | undefined);

// Refetch plugin (@spoosh/plugin-refetch)
refetch?: {
  onFocus?: boolean;
  onReconnect?: boolean;
};

// GC plugin (@spoosh/plugin-gc) - NO per-request options
// Configure at plugin level: maxAge, maxEntries, interval

// Progress plugin (@spoosh/plugin-progress)
progress?: boolean | { totalHeader?: string };
```

### Result

```typescript
type BaseReadResult<TData, TError, TMeta> = {
  /** True during the initial load (no data yet) */
  loading: boolean;

  /** True during any fetch operation */
  fetching: boolean;

  /** Response data from the API */
  data: TData | undefined;

  /** Error from the last failed request */
  error: TError | undefined;

  /** Plugin-provided metadata */
  meta: TMeta;

  /** Abort the current fetch operation */
  abort: () => void;

  /** Manually trigger a fetch */
  trigger: (options?: { force?: boolean }) => Promise<SpooshResponse<TData, TError>>;
};
```

## useWrite

### Complete Signature

```typescript
function useWrite<TData, TError, TBody, TTransformed = TData>(
  requestFn: (api: SpooshApi) => WriteMethod<TData, TBody>,
  hookOptions?: UseWriteOptions<TData, TTransformed>
): UseWriteResult<TData, TError, TOptions, TMeta>;
```

**Note:** useWrite accepts hook-level options as a second argument for options that affect type inference (like `transform`).

### Hook Options (second argument)

```typescript
// Plugin hook options (require corresponding plugins)

// Transform plugin (@spoosh/plugin-transform)
transform?: (data: TData) => TTransformed;

// Retry plugin (@spoosh/plugin-retry) - can also be in trigger
retries?: number | false;
retryDelay?: number;
```

### Trigger Options

```typescript
// Core trigger options (always available)
type CoreTriggerOptions<TBody> = {
  body?: TBody;
  params?: Record<string, string | number>;
  query?: Record<string, unknown>;
  headers?: HeadersInit;
};

// Plugin trigger options (require corresponding plugins)

// Cache plugin (@spoosh/plugin-cache)
clearCache?: boolean;

// Invalidation plugin (@spoosh/plugin-invalidation)
invalidate?: "all" | "self" | "none" | "*" | string | string[];

// Optimistic plugin (@spoosh/plugin-optimistic)
optimistic?: (cache) => cache("path").filter(entry => ...).set(fn);  // Fluent API

// Progress plugin (@spoosh/plugin-progress)
progress?: boolean | { totalHeader?: string };
```

### Result

```typescript
type BaseWriteResult<TData, TError, TOptions, TMeta> = {
  /** Execute the mutation with optional options */
  trigger: (options?: TOptions) => Promise<SpooshResponse<TData, TError>>;

  /** True while the mutation is in progress */
  loading: boolean;

  /** Response data from the API */
  data: TData | undefined;

  /** Error from the last failed request */
  error: TError | undefined;

  /** Plugin-provided metadata */
  meta: TMeta;

  /** The last trigger input (body, params, query) */
  input: { body?: TBody; params?: TParams; query?: TQuery } | undefined;

  /** Abort the current mutation */
  abort: () => void;
};
```

## usePages

### Complete Signature

```typescript
function usePages<TData, TError, TMeta, TItem>(
  requestFn: (api: SpooshApi) => RequestConfig<TData>,
  options: UsePagesOptions<TData, TError, TMeta, TItem>
): UsePagesResult<TData, TError, TMeta, TItem>;
```

### InfinitePage Structure

```typescript
interface InfinitePage<TData, TError, TMeta> {
  status: "pending" | "loading" | "success" | "error" | "stale";
  data?: TData;
  error?: TError;
  meta?: TMeta;
  input?: InfiniteRequestOptions;
}
```

### Options

```typescript
type BasePagesOptions<TData, TError, TMeta, TItem, TRequest> = {
  /** Whether to fetch automatically on mount. Default: true */
  enabled?: boolean;

  /** Tag configuration */
  tags?: TagMode | (TagModeInArray | (string & {}))[];

  /** Callback to determine if there's a next page to fetch */
  canFetchNext: (ctx: InfiniteNextContext<TData, TError, TMeta, TRequest>) => boolean;

  /** Callback to build the request options for the next page */
  nextPageRequest: (ctx: InfiniteNextContext<TData, TError, TMeta, TRequest>) => Partial<TRequest>;

  /** Callback to merge all pages into a single array of items */
  merger: (pages: InfinitePage<TData, TError, TMeta>[]) => TItem[];

  /** Callback to determine if there's a previous page to fetch */
  canFetchPrev?: (ctx: InfinitePrevContext<TData, TError, TMeta, TRequest>) => boolean;

  /** Callback to build the request options for the previous page */
  prevPageRequest?: (ctx: InfinitePrevContext<TData, TError, TMeta, TRequest>) => Partial<TRequest>;

  // Plus plugin options (same as useRead)
};

type InfiniteNextContext<TData, TError, TMeta, TRequest> = {
  lastPage: InfinitePage<TData, TError, TMeta> | undefined;
  pages: InfinitePage<TData, TError, TMeta>[];
  request: TRequest;
};

type InfinitePrevContext<TData, TError, TMeta, TRequest> = {
  firstPage: InfinitePage<TData, TError, TMeta> | undefined;
  pages: InfinitePage<TData, TError, TMeta>[];
  request: TRequest;
};
```

### Result

```typescript
type BasePagesResult<TData, TError, TMeta, TItem, TPluginResult> = {
  /** Merged items from all fetched pages */
  data: TItem[] | undefined;

  /** Array of all page objects with status, data, error, meta */
  pages: InfinitePage<TData, TError, TMeta>[] | undefined;

  /** True during the initial load (no data yet) */
  loading: boolean;

  /** True during any fetch operation */
  fetching: boolean;

  /** True while fetching the next page */
  fetchingNext: boolean;

  /** True while fetching the previous page */
  fetchingPrev: boolean;

  /** Whether there's a next page available to fetch */
  canFetchNext: boolean;

  /** Whether there's a previous page available to fetch */
  canFetchPrev: boolean;

  /** Plugin-provided metadata */
  meta: TPluginResult;

  /** Fetch the next page */
  fetchNext: () => Promise<void>;

  /** Fetch the previous page */
  fetchPrev: () => Promise<void>;

  /** Trigger refetch of all pages from the beginning */
  trigger: () => Promise<void>;

  /** Abort the current fetch operation */
  abort: () => void;

  /** Error from the last failed request */
  error: TError | undefined;
};
```

## useQueue

### Complete Signature

```typescript
function useQueue<TQueueFn>(
  queueFn: TQueueFn,
  queueOptions?: UseQueueOptions
): UseQueueResult<TData, TError, TTriggerInput, TMeta>;
```

### Options

```typescript
interface UseQueueOptions {
  /** Maximum concurrent operations. Defaults to 3. */
  concurrency?: number;
}
```

### QueueItem Structure

```typescript
interface QueueItem<TData, TError, TMeta> {
  /** Unique task identifier */
  id: string;

  /** Current task status */
  status: "pending" | "loading" | "success" | "error" | "aborted";

  /** Response data (when status is "success") */
  data?: TData;

  /** Error (when status is "error") */
  error?: TError;

  /** Plugin metadata */
  meta?: TMeta;

  /** Original request input */
  input: {
    body?: TBody;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  };
}
```

### QueueStats Structure

```typescript
interface QueueStats {
  /** Tasks waiting to be processed */
  pending: number;

  /** Currently executing tasks */
  loading: number;

  /** Completed tasks (success + error + aborted) */
  settled: number;

  /** Successfully completed tasks */
  success: number;

  /** Failed tasks */
  failed: number;

  /** All tasks */
  total: number;

  /** Completion percentage (0-100) */
  percentage: number;
}
```

### Result

```typescript
type UseQueueResult<TData, TError, TTriggerInput, TMeta> = {
  /** Add item to queue and execute. Returns promise for this item. */
  trigger: (input?: TTriggerInput) => Promise<SpooshResponse<TData, TError>>;

  /** All tasks in queue with their current status */
  tasks: QueueItem<TData, TError, TMeta>[];

  /** Queue statistics */
  stats: QueueStats;

  /** Abort task by ID, or all tasks if no ID */
  abort: (id?: string) => void;

  /** Retry failed task by ID, or all failed if no ID */
  retry: (id?: string) => Promise<void>;

  /** Remove specific task by ID (aborts if active) */
  remove: (id: string) => void;

  /** Remove all settled tasks (success, error, aborted). Keeps pending/loading. */
  removeSettled: () => void;

  /** Abort all and clear queue */
  clear: () => void;

  /** Update concurrency limit */
  setConcurrency: (concurrency: number) => void;
};
```

### Trigger Input

```typescript
type QueueTriggerInput = {
  /** Custom ID for this queue item. Auto-generated if not provided. */
  id?: string;
  body?: TBody;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
};
```

### Example

```typescript
function BulkUploader({ files }: { files: File[] }) {
  const { tasks, stats, trigger, retry, clear } = useQueue(
    (api) => api("files").POST(),
    { concurrency: 3 }
  );

  const handleUpload = () => {
    files.forEach((file) => {
      trigger({ body: form({ file }) });
    });
  };

  return (
    <div>
      <button onClick={handleUpload}>Upload All</button>
      <p>Progress: {stats.success}/{stats.total} ({stats.percentage}%)</p>
      <p>Failed: {stats.failed}</p>

      {stats.failed > 0 && (
        <button onClick={() => retry()}>Retry All Failed</button>
      )}

      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.status === "loading" && "Uploading..."}
            {task.status === "success" && "Done"}
            {task.status === "error" && `Error: ${task.error?.message}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## useSSE

### Complete Signature

```typescript
function useSSE<TSubFn>(
  subFn: TSubFn,
  sseOptions?: UseSSEOptions
): UseSSEResult<TEvents, TError>;
```

### Options

```typescript
interface UseSSEOptions {
  /** Whether the subscription is enabled. Defaults to true. */
  enabled?: boolean;

  /** Max retry attempts on connection failure */
  maxRetries?: number;

  /** Delay between retries in ms */
  retryDelay?: number;

  /** Event types to listen for. If not provided, listens to all events. */
  events?: string[];

  /** Parse strategy for SSE event data. Defaults to 'auto'. */
  parse?: ParseStrategy | Record<string, ParseStrategy>;

  /** Accumulate strategy for combining events. Defaults to 'replace'. */
  accumulate?: AccumulateStrategy | Record<string, AccumulateStrategy | AccumulatorFn>;
}

type ParseStrategy = "auto" | "json" | "text" | "json-done";
type AccumulateStrategy = "replace" | "merge";
type AccumulatorFn<T = unknown> = (previous: T | undefined, current: T) => T;
```

### Parse Strategies

| Strategy | Description |
|----------|-------------|
| `"auto"` | Automatically detect JSON or text format |
| `"json"` | Parse each event data as JSON |
| `"text"` | Keep event data as raw text |
| `"json-done"` | Parse as JSON, complete stream on `[DONE]` event |

### Accumulate Strategies

| Strategy | Description |
|----------|-------------|
| `"replace"` | Only keep the latest event data |
| `"merge"` | Accumulate all events into an array |

### Result

```typescript
interface UseSSEResult<TEvents, TError> {
  /** Accumulated data keyed by event type */
  data: Partial<TEvents> | undefined;

  /** Connection or parse error */
  error: TError | undefined;

  /** Whether currently connected to the SSE endpoint */
  isConnected: boolean;

  /** Whether connection is in progress */
  loading: boolean;

  /** Plugin metadata */
  meta: Record<string, never>;

  /** Manually trigger connection with optional body/query overrides */
  trigger: (options?: { body?: unknown; query?: unknown }) => Promise<void>;

  /** Disconnect from the SSE endpoint */
  disconnect: () => void;

  /** Reset accumulated data */
  reset: () => void;
}
```

### Example: Chat Streaming

```typescript
function ChatStream({ prompt }: { prompt: string }) {
  const { data, isConnected, error, trigger, disconnect } = useSSE(
    (api) => api("chat/stream").POST({ body: { prompt } }),
    {
      parse: "json-done",
      accumulate: "merge",
    }
  );

  if (error) {
    return (
      <div>
        <p>Connection error: {error.message}</p>
        <button onClick={() => trigger()}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      {isConnected && <span>Streaming...</span>}
      <div>{data?.message?.map((chunk) => chunk.text).join("")}</div>
    </div>
  );
}
```

### Example: Live Updates

```typescript
function LivePrices() {
  const { data, isConnected, trigger, disconnect } = useSSE(
    (api) => api("prices/stream").GET(),
    {
      parse: "json",
      accumulate: "replace",
      maxRetries: 5,
      retryDelay: 2000,
    }
  );

  return (
    <div>
      <p>Status: {isConnected ? "Live" : "Disconnected"}</p>
      <button onClick={isConnected ? disconnect : () => trigger()}>
        {isConnected ? "Pause" : "Resume"}
      </button>

      {data?.prices && (
        <ul>
          {Object.entries(data.prices).map(([symbol, price]) => (
            <li key={symbol}>{symbol}: ${price}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

## Response Format

All hooks return responses as a discriminated union:

```typescript
type SpooshResponse<TData, TError> =
  // Success case
  | {
      status: number;
      data: TData;
      headers?: Headers;
      error?: undefined;
      aborted?: false;
      input: { query?: unknown; body?: unknown; params?: Record<string, string> };
    }
  // Error case
  | {
      status: number;
      data?: undefined;
      headers?: Headers;
      error: TError;
      aborted?: boolean;
      input: { query?: unknown; body?: unknown; params?: Record<string, string> };
    };
```

## Plugin Results (meta)

The `meta` field contains plugin-specific results. Types flow automatically from installed plugins through TypeScript type merging.

**Important:** Meta values only appear when the corresponding plugin option is used.

```typescript
// Types are automatically inferred from installed plugins:

// Progress plugin (only when { progress: true } option is passed)
// NOTE: There is NO percentage field - calculate it manually!
meta.progress?: {
  loaded: number;   // Bytes transferred
  total: number;    // Total bytes (0 if unknown)
};

// Initial data plugin (only when initialData option is used)
meta.isInitialData?: boolean;

// Optimistic plugin (only during optimistic updates)
meta.isOptimistic?: boolean;

// Transform plugin (useWrite only) - REQUIRES CASTING
// transformedData is typed as unknown, cast to your expected type
meta.transformedData as YourType;
```

**Example: Accessing progress**
```typescript
const { meta } = useRead(
  (api) => api("file").GET(),
  { progress: true }  // Must enable progress!
);

// Types are inferred - no casting needed
const percentage = meta.progress?.total && meta.progress.total > 0
  ? Math.round((meta.progress.loaded / meta.progress.total) * 100)
  : 0;
```

**Example: Accessing transformedData (with hook-level transform)**
```typescript
const { trigger, meta } = useWrite(
  (api) => api("data").POST(),
  { transform: (response) => response.items.map(normalize) }
);

await trigger({ body: data });

// transformedData is typed based on transform function
const items = meta.transformedData;  // Type: NormalizedItem[]
```
