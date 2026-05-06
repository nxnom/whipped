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
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500">
                    <p className="text-sm font-medium text-gray-400">Something went wrong</p>
                    <p className="text-xs text-gray-600 max-w-sm text-center">{this.state.error.message}</p>
                    <button
                        onClick={() => this.setState({ error: null })}
                        className="text-xs text-blue-400 hover:text-blue-300"
                    >
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
