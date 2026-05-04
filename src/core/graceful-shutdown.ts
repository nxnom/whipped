export function installGracefulShutdownHandlers(options: {
	process: NodeJS.Process;
	delayMs: number;
	exit: (code: number) => void;
	onShutdown: () => Promise<void>;
	onShutdownError: (error: unknown) => void;
	onTimeout: (delayMs: number) => void;
	onSecondSignal: (signal: string) => void;
}): void {
	const { process, delayMs, exit, onShutdown, onShutdownError, onTimeout, onSecondSignal } = options;

	let shutdownStarted = false;
	let shutdownSignalCount = 0;

	const handleSignal = (signal: string) => {
		shutdownSignalCount++;

		if (shutdownSignalCount > 1) {
			onSecondSignal(signal);
			exit(1);
			return;
		}

		if (shutdownStarted) {
			return;
		}

		shutdownStarted = true;

		const timeout = setTimeout(() => {
			onTimeout(delayMs);
			exit(1);
		}, delayMs);

		timeout.unref();

		onShutdown()
			.then(() => {
				clearTimeout(timeout);
				exit(0);
			})
			.catch((error) => {
				clearTimeout(timeout);
				onShutdownError(error);
				exit(1);
			});
	};

	process.on("SIGINT", () => handleSignal("SIGINT"));
	process.on("SIGTERM", () => handleSignal("SIGTERM"));
}
