import { RHFInput } from "@geckoui/geckoui";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { SECRET_INPUT_CLASS } from "./constants";

// Reusable show/hide password toggle rendered as the RHFInput `suffix`.
export function SecretToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-80 transition-opacity text-whip-text"
		>
			{visible ? <EyeOff size={14} /> : <Eye size={14} />}
		</button>
	);
}

// RHF-bound secret field with a show/hide toggle. Wraps RHFInput in type
// password/text and renders the toggle as a suffix.
export function RHFSecretInput({ name, placeholder }: { name: string; placeholder: string }) {
	const [visible, setVisible] = useState(false);
	return (
		<RHFInput
			name={name}
			type={visible ? "text" : "password"}
			placeholder={placeholder}
			className="relative"
			inputClassName={SECRET_INPUT_CLASS}
			suffix={<SecretToggle visible={visible} onToggle={() => setVisible((v) => !v)} />}
		/>
	);
}
