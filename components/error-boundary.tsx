"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
    children: ReactNode;
    /** Optional fallback UI; defaults to a compact error card. */
    fallback?: ReactNode;
    /** Human-readable label for where this boundary is mounted. */
    label?: string;
}

interface ErrorBoundaryState {
    hasError: boolean;
    message: string;
}

/**
 * Catches render-time exceptions so one bad token stream or malformed model
 * output cannot white-screen the whole app. Model output is untrusted input;
 * anything that renders it should live inside one of these boundaries.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    constructor(props: ErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, message: "" };
    }

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, message: error.message };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback !== undefined) {
                return this.props.fallback;
            }
            return (
                <div
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                    {this.props.label ? `${this.props.label}: ` : ""}
                    Something failed to render.{" "}
                    <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => this.setState({ hasError: false, message: "" })}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
