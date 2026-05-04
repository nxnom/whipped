import type { AppRouter } from "@runtime-trpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

const baseUrl = `${window.location.protocol}//${window.location.host}/api/trpc`;

export const trpc = createTRPCClient<AppRouter>({
	links: [
		httpBatchLink({
			url: baseUrl,
		}),
	],
});
