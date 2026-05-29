# Advanced Spoosh React Patterns

## Dependent Queries

Fetch data that depends on another query's result.

```typescript
export function UserPosts({ userId }: { userId: string }) {
  const { data: user, loading: userLoading } = useRead(
    (api) => api("users/:id").GET({ params: { id: userId } })
  );

  const { data: posts, loading: postsLoading } = useRead(
    (api) => api("users/:id/posts").GET({
      params: { id: userId },
      query: { category: user?.defaultCategory }
    }),
    { enabled: !!user }
  );

  if (userLoading || postsLoading) return <Skeleton />;

  return (
    <div>
      <h1>{user?.name}'s Posts</h1>
      {posts?.map(post => <PostCard key={post.id} post={post} />)}
    </div>
  );
}
```

## Parallel Queries

Fetch multiple independent resources simultaneously.

```typescript
export function Dashboard() {
  const { data: user, loading: userLoading } = useRead(
    (api) => api("me").GET()
  );

  const { data: notifications, loading: notifLoading } = useRead(
    (api) => api("notifications").GET()
  );

  const { data: stats, loading: statsLoading } = useRead(
    (api) => api("stats").GET()
  );

  const loading = userLoading || notifLoading || statsLoading;

  if (loading) return <DashboardSkeleton />;

  return (
    <div>
      <Header user={user} notifications={notifications} />
      <StatsOverview stats={stats} />
    </div>
  );
}
```

## Prefetching on Hover

```typescript
// In your spoosh setup file (e.g., lib/spoosh.ts)
import { Spoosh } from "@spoosh/core";
import { create } from "@spoosh/react";
import { prefetchPlugin } from "@spoosh/plugin-prefetch";

const spoosh = new Spoosh<ApiSchema>("/api")
  .use([prefetchPlugin()]);

// prefetch comes from create(), not from spoosh directly
export const { useRead, useWrite, prefetch } = create(spoosh);

// In your component
import { prefetch } from "@/lib/spoosh";

export function UserCard({ user }: { user: User }) {
  const handleMouseEnter = () => {
    prefetch((api) => api("users/:id").GET({ params: { id: user.id } }));
    prefetch((api) => api("users/:id/posts").GET({ params: { id: user.id } }));
  };

  return (
    <Link
      to={`/users/${user.id}`}
      onMouseEnter={handleMouseEnter}
    >
      {user.name}
    </Link>
  );
}
```

## Mutation with Rollback

```typescript
export function EditableTitle({ item }: { item: Item }) {
  const [title, setTitle] = useState(item.title);
  const [editing, setEditing] = useState(false);
  const { trigger, loading } = useWrite((api) => api("items/:id").PUT());

  const handleSave = async () => {
    const previousTitle = item.title;

    const result = await trigger({
      params: { id: item.id },
      body: { title },
      optimistic: (cache) => cache(`items/${item.id}`)
        .set((current) => ({ ...current, title }))
    });

    if (result.error) {
      setTitle(previousTitle);
      toast.error("Failed to save");
    } else {
      setEditing(false);
    }
  };

  if (!editing) {
    return (
      <h1 onClick={() => setEditing(true)}>
        {title}
      </h1>
    );
  }

  return (
    <input
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={handleSave}
      disabled={loading}
      autoFocus
    />
  );
}
```

## Bidirectional Infinite Scroll

For chat-like interfaces where you can scroll up for older messages.

```typescript
export function ChatMessages({ chatId }: { chatId: string }) {
  const {
    data,
    loading,
    fetchingNext,
    fetchingPrev,
    canFetchNext,
    canFetchPrev,
    fetchNext,
    fetchPrev
  } = usePages(
    (api) => api("chats/:id/messages").GET({
      params: { id: chatId },
      query: { cursor: null }
    }),
    {
      canFetchNext: ({ lastPage }) => !!lastPage?.data?.nextCursor,
      nextPageRequest: ({ lastPage }) => ({
        query: { cursor: lastPage?.data?.nextCursor }
      }),
      canFetchPrev: ({ firstPage }) => !!firstPage?.data?.prevCursor,
      prevPageRequest: ({ firstPage }) => ({
        query: { cursor: firstPage?.data?.prevCursor }
      }),
      merger: (pages) => pages.flatMap(p => p.data?.messages ?? [])
    }
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;

    if (el.scrollTop === 0 && canFetchPrev && !fetchingPrev) {
      fetchPrev();
    }

    if (el.scrollHeight - el.scrollTop === el.clientHeight && canFetchNext && !fetchingNext) {
      fetchNext();
    }
  };

  return (
    <div ref={containerRef} onScroll={handleScroll}>
      {fetchingPrev && <LoadingSpinner />}
      {data?.map(message => <Message key={message.id} message={message} />)}
      {fetchingNext && <LoadingSpinner />}
    </div>
  );
}
```

## Real-time Updates with Polling + Invalidation

```typescript
export function LiveDashboard() {
  const { data: stats } = useRead(
    (api) => api("stats").GET(),
    { pollingInterval: 30000 }
  );

  const { trigger: refresh } = useWrite((api) => api("stats/refresh").POST());

  const handleManualRefresh = async () => {
    await refresh({ invalidate: ["stats"] });
  };

  return (
    <div>
      <button onClick={handleManualRefresh}>Refresh Now</button>
      <StatsDisplay stats={stats} />
    </div>
  );
}
```

## File Upload with Progress

Use the `form()` utility from `@spoosh/core` for file uploads. Progress must be explicitly enabled with `{ progress: true }`.

**Important:** There is no `percentage` property in progress - only `loaded` and `total`. Calculate percentage manually.

```typescript
import { form } from "@spoosh/core";

export function FileUploader() {
  const { trigger, loading, meta } = useWrite(
    (api) => api("files").POST()
  );

  // Types flow automatically - no casting needed
  const percentage = meta.progress?.total && meta.progress.total > 0
    ? Math.round((meta.progress.loaded / meta.progress.total) * 100)
    : 0;

  const handleUpload = async (file: File) => {
    // Use form() utility for proper Content-Type handling
    await trigger({
      body: form({ file }),
      progress: true  // Must enable progress tracking!
    });
  };

  return (
    <div>
      <input type="file" onChange={(e) => handleUpload(e.target.files![0])} />

      {loading && meta.progress && (
        <>
          <ProgressBar value={percentage} />
          <span>{meta.progress.loaded} / {meta.progress.total} bytes ({percentage}%)</span>
        </>
      )}
    </div>
  );
}
```

**Body Utilities from `@spoosh/core`:**
- `form(data)` - For `multipart/form-data` (supports files and binary data)
- `json(data)` - For `application/json` (default for plain objects)
- `urlencoded(data)` - For `application/x-www-form-urlencoded`

## Custom Hook Composition

```typescript
function useUser(userId: string) {
  return useRead(
    (api) => api("users/:id").GET({ params: { id: userId } }),
    { staleTime: 60000 }
  );
}

function useUserPosts(userId: string, enabled = true) {
  return useRead(
    (api) => api("users/:id/posts").GET({ params: { id: userId } }),
    { enabled, staleTime: 30000 }
  );
}

function useUpdateUser() {
  return useWrite((api) => api("users/:id").PUT());
}

export function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading } = useUser(userId);
  const { data: posts } = useUserPosts(userId, !!user);
  const { trigger: updateUser, loading: updating } = useUpdateUser();

  // ...
}
```

## Abort on Unmount

Spoosh automatically handles request cancellation on component unmount, but you can also manually abort:

```typescript
export function SearchWithCancel() {
  const { data, fetching, trigger, abort } = useRead(
    (api) => api("search").GET({ query: { q: query } }),
    { enabled: false }
  );

  const handleSearch = async () => {
    abort();
    await trigger();
  };

  return (
    <div>
      <button onClick={handleSearch}>Search</button>
      {fetching && <button onClick={abort}>Cancel</button>}
    </div>
  );
}
```

## Error Retry with Backoff

```typescript
export function ResilientDataFetcher() {
  const { data, error, loading } = useRead(
    (api) => api("flaky-endpoint").GET(),
    {
      retry: {
        retries: 5,
        delay: 1000,
        // shouldRetry receives a context object, not a response
        shouldRetry: ({ status, error, attempt, maxRetries }) => {
          if (status === 401) return false;
          if (status === 403) return false;
          if (status === 404) return false;
          return status !== undefined && status >= 500;
        }
      }
    }
  );

  // ...
}
```
