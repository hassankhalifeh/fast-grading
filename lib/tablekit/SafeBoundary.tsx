"use client";

import React from "react";

// Anything rendered inside can crash without taking the page down: on error it shows `fallback`
// (nothing by default) and the rest of the app keeps working.
export class SafeBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode; onError?: (e: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    try { this.props.onError?.(error); } catch { /* reporting must never break anything */ }
    if (typeof console !== "undefined") console.warn("[tablekit] disabled after an error:", error.message);
  }

  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
