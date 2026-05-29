import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

// Thin wrapper around hono/zod-validator that throws the ZodError on failure so
// errorHandler.ts produces the response (controllers never check validation).
export const zv = <T extends ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) =>
	zValidator(target, schema, (result) => {
		if (!result.success) {
			throw result.error;
		}
	});
