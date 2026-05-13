import type { WebSocket } from "ws";
import type { RunSessionStatus, RuntimeStateEvent } from "../core/api-contract.js";
import { loadWorkspaceState } from "../state/workspace-state.js";

type WorkspaceId = string;
type ClientId = string;

interface ConnectedClient {
	id: ClientId;
	ws: WebSocket;
	workspaceId: WorkspaceId;
}

type TerminalOutputCallback = (streamId: string, data: string) => void;

export class RuntimeStateHub {
	private clients = new Map<ClientId, ConnectedClient>();
	private workspaceClients = new Map<WorkspaceId, Set<ClientId>>();
	private workspaceMeta = new Map<WorkspaceId, { repoPath: string }>();
	private terminalListeners = new Map<WorkspaceId, Set<TerminalOutputCallback>>();
	private terminalBuffers = new Map<string, string>(); // key: `${workspaceId}:${streamId}`
	private readonly MAX_TERMINAL_BUFFER_ENTRIES = 300;

	addTerminalListener(workspaceId: WorkspaceId, cb: TerminalOutputCallback): () => void {
		if (!this.terminalListeners.has(workspaceId)) {
			this.terminalListeners.set(workspaceId, new Set());
		}
		this.terminalListeners.get(workspaceId)?.add(cb);
		return () => {
			this.terminalListeners.get(workspaceId)?.delete(cb);
			const set = this.terminalListeners.get(workspaceId);
			if (set && set.size === 0) this.terminalListeners.delete(workspaceId);
		};
	}

	registerWorkspace(workspaceId: WorkspaceId, repoPath: string): void {
		this.workspaceMeta.set(workspaceId, { repoPath });
		if (!this.workspaceClients.has(workspaceId)) {
			this.workspaceClients.set(workspaceId, new Set());
		}
	}

	addClient(ws: WebSocket, workspaceId: WorkspaceId): ClientId {
		const clientId = Math.random().toString(36).slice(2);
		this.clients.set(clientId, { id: clientId, ws, workspaceId });

		let clientSet = this.workspaceClients.get(workspaceId);
		if (!clientSet) {
			clientSet = new Set();
			this.workspaceClients.set(workspaceId, clientSet);
		}
		clientSet.add(clientId);

		ws.on("close", () => {
			this.removeClient(clientId);
		});

		return clientId;
	}

	removeClient(clientId: ClientId): void {
		const client = this.clients.get(clientId);
		if (!client) return;
		this.clients.delete(clientId);
		this.workspaceClients.get(client.workspaceId)?.delete(clientId);
	}

	async sendSnapshot(clientId: ClientId, workspaceId: WorkspaceId, repoPath: string): Promise<void> {
		const client = this.clients.get(clientId);
		if (!client) return;

		const state = await loadWorkspaceState(workspaceId, repoPath);
		this.sendToClient(client, { type: "snapshot", state });
	}

	broadcastWorkspaceUpdate(workspaceId: WorkspaceId): void {
		const meta = this.workspaceMeta.get(workspaceId);
		if (!meta) return;

		// Load state async and broadcast
		loadWorkspaceState(workspaceId, meta.repoPath)
			.then((state) => {
				this.broadcastToWorkspace(workspaceId, { type: "workspace_updated", state });
			})
			.catch(() => {});
	}

	broadcastTerminalOutput(workspaceId: WorkspaceId, taskId: string, data: string): void {
		const key = `${workspaceId}:${taskId}`;
		const prev = this.terminalBuffers.get(key) ?? "";
		const next = prev + data;
		this.terminalBuffers.set(key, next.length > 65536 ? next.slice(-65536) : next);
		if (this.terminalBuffers.size > this.MAX_TERMINAL_BUFFER_ENTRIES) {
			const oldest = this.terminalBuffers.keys().next().value;
			if (oldest) this.terminalBuffers.delete(oldest);
		}
		this.broadcastToWorkspace(workspaceId, { type: "terminal_output", taskId, data });
		this.terminalListeners.get(workspaceId)?.forEach((cb) => {
			cb(taskId, data);
		});
	}

	getTerminalBuffer(workspaceId: WorkspaceId, streamId: string): string {
		return this.terminalBuffers.get(`${workspaceId}:${streamId}`) ?? "";
	}

	clearTerminalBuffer(workspaceId: WorkspaceId, streamId: string): void {
		this.terminalBuffers.delete(`${workspaceId}:${streamId}`);
	}

	broadcastAutonomousModeChange(workspaceId: WorkspaceId, enabled: boolean): void {
		this.broadcastToWorkspace(workspaceId, { type: "autonomous_mode_changed", enabled });
	}

	broadcastRunSessionChange(
		workspaceId: WorkspaceId,
		cardId: string | null,
		status: RunSessionStatus,
		errorMessage?: string,
	): void {
		this.broadcastToWorkspace(workspaceId, { type: "run_session_changed", cardId, status, errorMessage });
	}

	private broadcastToWorkspace(workspaceId: WorkspaceId, event: RuntimeStateEvent): void {
		const clientIds = this.workspaceClients.get(workspaceId);
		if (!clientIds) return;

		const payload = JSON.stringify(event);
		for (const clientId of clientIds) {
			const client = this.clients.get(clientId);
			if (client?.ws.readyState === 1 /* OPEN */) {
				client.ws.send(payload);
			}
		}
	}

	private sendToClient(client: ConnectedClient, event: RuntimeStateEvent): void {
		if (client.ws.readyState === 1 /* OPEN */) {
			client.ws.send(JSON.stringify(event));
		}
	}
}
