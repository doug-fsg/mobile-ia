"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: "inline" | "fullscreen";
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback === "inline") {
      return (
        <div className="h-full flex items-center justify-center px-6">
          <div className="text-center max-w-sm">
            <p className="text-[13px] font-medium text-text mb-2">Algo deu errado</p>
            <p className="text-[11px] text-text-muted mb-3 font-mono break-all">
              {this.state.error.message}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-3 py-1 rounded-lg text-[12px] font-medium bg-bg-surface text-text border border-border hover:bg-bg-hover transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="h-dvh flex items-center justify-center bg-[#0a0a0b] px-6">
        <div className="text-center max-w-sm">
          <p className="text-[14px] font-medium text-[#e8e8e8] mb-2">Algo deu errado</p>
          <p className="text-[12px] text-[#888] mb-4 font-mono break-all">
            {this.state.error.message}
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-[#1c1c1c] text-[#e8e8e8] border border-[#2a2a2a] hover:bg-[#252525] transition-colors"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
}
