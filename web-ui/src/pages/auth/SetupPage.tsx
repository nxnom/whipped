import { Alert, LoadingButton, RHFError, RHFInput } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import { type SetupForm, setupFormSchema } from "@runtime-validation/auth";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useWrite } from "@/runtime/api-client";
import { AuthLayout } from "./AuthLayout";

export function SetupPage() {
	const { trigger, loading } = useWrite((api) => api("auth/setup").POST());
	const [formError, setFormError] = useState<string | null>(null);

	const methods = useForm<SetupForm>({
		resolver: zodResolver(setupFormSchema),
		defaultValues: { password: "", confirmPassword: "" },
	});

	const onSubmit = methods.handleSubmit(async ({ password }) => {
		setFormError(null);
		const res = await trigger({ body: { password } });
		// Setup is local-only — a tunnelled request gets a 403 telling the user to
		// use the CLI instead.
		if (res.error) {
			setFormError(res.error.message ?? "Could not set the password");
		}
	});

	return (
		<AuthLayout title="Set a password" subtitle="Protect this daemon before exposing it">
			<FormProvider {...methods}>
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					{formError && <Alert variant="error" title={formError} condensed />}
					<div className="flex flex-col gap-1.5">
						<RHFInput name="password" type="password" placeholder="New password" className="w-full" />
						<RHFError name="password" />
					</div>
					<div className="flex flex-col gap-1.5">
						<RHFInput name="confirmPassword" type="password" placeholder="Confirm password" className="w-full" />
						<RHFError name="confirmPassword" />
					</div>
					<LoadingButton type="submit" className="w-full" loading={loading} loadingText="Saving...">
						Set password
					</LoadingButton>
					<p className="text-[11px] text-[#5f6672] text-center">
						Prefer the terminal? Run <span className="font-mono text-[#8a8f98]">whipped auth set-password</span>
					</p>
				</form>
			</FormProvider>
		</AuthLayout>
	);
}
