import type { ErrorHandler } from "hono";
import { treeifyError, ZodError } from "zod";
import { logger } from "../../core/logger.js";
import type { AppEnv } from "../types/context.js";
import { ApiError } from "./http-errors.js";

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
	if (err instanceof ApiError) {
		return c.json({ message: err.message, details: err.details }, err.statusCode);
	}

	if (err instanceof ZodError) {
		return c.json({ message: "Validation failed", details: treeifyError(err) }, 400);
	}

	logger.error({ err }, "[api] unhandled error");
	return c.json({ message: "Internal server error" }, 500);
};
