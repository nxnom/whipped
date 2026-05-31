import { LoadingButton, RHFError, RHFInput } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type LoginForm, loginFormSchema } from "@runtime-validation/auth";
import { FormProvider, useForm } from "react-hook-form";
import { useWrite } from "@/runtime/api-client";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
	const { trigger, loading } = useWrite((api) => api("auth/login").POST());

	const methods = useForm<LoginForm>({
		resolver: zodResolver(loginFormSchema),
		defaultValues: { password: "" },
	});

	const onSubmit = methods.handleSubmit(async ({ password }) => {
		const res = await trigger({ body: { password } });
		// Success auto-invalidates auth/status; the AuthGate refetch unmounts this page.
		if (res.error) {
			methods.setError("password", { message: "Incorrect password" });
		}
	});

	return (
		<AuthLayout title="Welcome back" subtitle="Enter your password to continue">
			<FormProvider {...methods}>
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<RHFInput name="password" type="password" placeholder="Password" className="w-full" autoFocus />
						<RHFError name="password" />
					</div>
					<LoadingButton type="submit" className="w-full" loading={loading} loadingText="Signing in...">
						Sign in
					</LoadingButton>
				</form>
			</FormProvider>
		</AuthLayout>
	);
}
