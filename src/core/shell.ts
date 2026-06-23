// Resolve the platform shell used to run a user-provided command string
// (install commands, run/preview commands). Windows has no `sh`/`/bin/bash`,
// so commands there run through cmd.exe (`ComSpec`) with `/c`; POSIX uses the
// user's `$SHELL` with `-c`. Returns the tuple to pass straight to
// child_process.spawn / node-pty.spawn: [shell, [flag, command]].
export function getShellInvocation(command: string): [string, string[]] {
	if (process.platform === "win32") {
		return [process.env.ComSpec ?? "cmd.exe", ["/c", command]];
	}
	return [process.env.SHELL ?? "/bin/sh", ["-c", command]];
}
