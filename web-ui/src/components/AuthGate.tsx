import { Spinner } from "@geckoui/geckoui";
import type { ReactNode } from "react";
import { LoginPage } from "@/pages/auth/LoginPage";
import { SetupPage } from "@/pages/auth/SetupPage";
import { useRead } from "@/runtime/api-client";

// Gates the whole app behind auth. On a trusted local machine the backend lets
// every request through, so `authenticated` is reported true and the gate is a
// no-op; over a tunnel it forces setup/login. Login/setup writes auto-invalidate
// auth/status, so a success here re-renders straight into the app.
export function AuthGate({ children }: { children: ReactNode }) {
	const { data, loading } = useRead((api) => api("auth/status").GET());

	if (!data) {
		if (loading) {
			return (
				<div className="dark min-h-screen flex items-center justify-center bg-[#0f0f10]">
					<Spinner />
				</div>
			);
		}
		// Status couldn't load — fall back to login rather than a blank screen.
		return <LoginPage />;
	}

	if (data.needsSetup) return <SetupPage />;
	if (!data.authenticated) return <LoginPage />;
	return <>{children}</>;
}
