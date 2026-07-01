import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	render() {
		if (this.state.error) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center gap-3 text-[#8a8f98]">
					<p className="text-sm font-medium text-[#8a8f98]">Something went wrong</p>
					<p className="text-xs text-[#5f6672] max-w-sm text-center">{this.state.error.message}</p>
					<button
						onClick={() => this.setState({ error: null })}
						className="text-xs text-[#ededed] hover:text-[#ededed]"
					>
						Try again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
