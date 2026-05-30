import { RHFError, toast } from "@geckoui/geckoui";
import { zodResolver } from "@hookform/resolvers/zod";
import type { RuntimeGlobalConfig } from "@runtime-contract";
import { signingSecretSchema } from "@runtime-validation/slack";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { useWrite } from "@/runtime/api-client";
import { SECRET_INPUT_CLASS } from "./constants";
import { RHFSecretInput, SecretToggle } from "./SecretToggle";

export function AdvancedCredentials({
	config,
	onSaveToken,
	savingToken,
}: {
	config: RuntimeGlobalConfig;
	onSaveToken: (botToken: string) => void;
	savingToken: boolean;
}) {
	const [botToken, setBotToken] = useState(config.slackBotToken ?? "");
	const [tokenVisible, setTokenVisible] = useState(false);

	const methods = useForm({
		resolver: zodResolver(signingSecretSchema),
		values: { signingSecret: "" },
	});

	const updateSigningSecret = useWrite((api) => api("slack/updateSigningSecret").POST());

	const onSubmitSigningSecret = methods.handleSubmit(async (values) => {
		const res = await updateSigningSecret.trigger({ body: { signingSecret: values.signingSecret.trim() } });
		if (res.error) {
			toast.error("Failed to update signing secret");
			return;
		}
		methods.reset({ signingSecret: "" });
		toast.success("Signing secret updated");
	});

	return (
		<div className="flex flex-col gap-4 pl-4 border-l border-[#2a2a35]">
			<div className="flex flex-col gap-2">
				<p className="text-[12px] text-[#60607a]">Replace the bot token manually if needed.</p>
				<div className="flex gap-3 items-center">
					<div className="flex-1 relative">
						<input
							type={tokenVisible ? "text" : "password"}
							value={botToken}
							placeholder="xoxb-..."
							onChange={(e) => setBotToken(e.target.value)}
							className={SECRET_INPUT_CLASS}
						/>
						<SecretToggle visible={tokenVisible} onToggle={() => setTokenVisible((v) => !v)} />
					</div>
					<button
						onClick={() => onSaveToken(botToken)}
						disabled={savingToken}
						className="px-4 py-2 rounded-lg text-[13px] font-medium shrink-0 disabled:opacity-40 bg-[#7c6aff] text-white"
					>
						Save
					</button>
				</div>
			</div>
			<FormProvider {...methods}>
				<form onSubmit={onSubmitSigningSecret} className="flex flex-col gap-2">
					<p className="text-[12px] text-[#60607a]">
						Update signing secret if webhooks return signature mismatch. Find it at{" "}
						<a
							href={`https://api.slack.com/apps/${config.slackAppId ?? ""}/general`}
							target="_blank"
							rel="noreferrer"
							className="underline text-[#7c6aff]"
						>
							api.slack.com/apps → App Credentials → Signing Secret
						</a>
						.
					</p>
					<div className="flex gap-3 items-start">
						<div className="flex-1">
							<RHFSecretInput name="signingSecret" placeholder="Paste new signing secret..." />
							<RHFError name="signingSecret" className="text-[11px] text-[#ef4444] mt-1" />
						</div>
						<button
							type="submit"
							disabled={updateSigningSecret.loading}
							className="px-4 py-2 rounded-lg text-[13px] font-medium shrink-0 disabled:opacity-40 bg-[#7c6aff] text-white"
						>
							{updateSigningSecret.loading ? "Saving…" : "Save"}
						</button>
					</div>
				</form>
			</FormProvider>
		</div>
	);
}
