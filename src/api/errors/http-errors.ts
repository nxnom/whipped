import type { ContentfulStatusCode } from "hono/utils/http-status";

export class ApiError extends Error {
	constructor(
		public readonly statusCode: ContentfulStatusCode,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export const BadRequestError = (message = "Bad request", details?: unknown) => new ApiError(400, message, details);

export const UnauthorizedError = (message = "Unauthorized") => new ApiError(401, message);

export const ForbiddenError = (message = "Forbidden") => new ApiError(403, message);

export const NotFoundError = (resource = "Resource") => new ApiError(404, `${resource} not found`);

export const ConflictError = (message = "Conflict", details?: unknown) => new ApiError(409, message, details);

export const PreconditionFailedError = (message = "Precondition failed", details?: unknown) =>
	new ApiError(412, message, details);

export const InternalError = (message = "Internal server error") => new ApiError(500, message);
