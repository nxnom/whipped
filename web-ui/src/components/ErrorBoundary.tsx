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
				<div className="flex-1 flex flex-col items-center justify-center gap-3 text-whip-muted">
					<p className="text-sm font-medium text-whip-muted">Something went wrong</p>
					<p className="text-xs text-whip-faint max-w-sm text-center">{this.state.error.message}</p>
					<button
						onClick={() => this.setState({ error: null })}
						className="text-xs text-whip-text hover:text-whip-text"
					>
						Try again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}
