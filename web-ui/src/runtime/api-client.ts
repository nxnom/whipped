import { Spoosh } from "@spoosh/core";
import type { StripPrefix } from "@spoosh/core";
import type { HonoToSpoosh } from "@spoosh/hono";
import { cachePlugin } from "@spoosh/plugin-cache";
import { deduplicationPlugin } from "@spoosh/plugin-deduplication";
import { invalidationPlugin } from "@spoosh/plugin-invalidation";
import { optimisticPlugin } from "@spoosh/plugin-optimistic";
import { create } from "@spoosh/react";
import type { ApiApp } from "@runtime-api";

export interface ApiErrorResponse {
	message: string;
	details?: unknown;
}

// Server types inferred straight from the Hono app. StripPrefix drops the "api"
// segment so api("config") resolves to /api/config (not /api/api/config).
export type ApiSchema = StripPrefix<HonoToSpoosh<ApiApp>, "api">;

const spoosh = new Spoosh<ApiSchema, ApiErrorResponse>("/api").use([
	cachePlugin(),
	deduplicationPlugin(),
	invalidationPlugin(),
	optimisticPlugin(),
]);

// `optimistic` is the standalone cache writer used to push WebSocket state
// straight into the cache (no mutation); `invalidate` for manual invalidation.
export const { useRead, useWrite, usePages, useQueue, optimistic, invalidate } = create(spoosh);
