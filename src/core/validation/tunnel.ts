import { z } from "zod";

// Pure zod schema for the Tunnel setup form. Mirrors the inline `z.object(...)`
// body in src/api/routes/tunnel.ts so the frontend (RHF + zodResolver) and
// backend (zv middleware) validate the same shape.

// POST /api/tunnel/createTunnel
export const createTunnelSchema = z.object({
	domain: z.string(),
});
export type CreateTunnelInput = z.infer<typeof createTunnelSchema>;
