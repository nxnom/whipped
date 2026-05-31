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

export type ApiSchema = StripPrefix<HonoToSpoosh<ApiApp>, "api">;

const spoosh = new Spoosh<ApiSchema, ApiErrorResponse>("/api").use([
	cachePlugin({
		staleTime: 5 * 60 * 1000,
	}),
	deduplicationPlugin(),
	invalidationPlugin(),
	optimisticPlugin(),
]);

export const { useRead, useWrite, usePages, useQueue, optimistic, invalidate } = create(spoosh);
