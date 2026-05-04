import { randomBytes } from "node:crypto";

export function generateTaskId(): string {
	return randomBytes(8).toString("hex");
}
