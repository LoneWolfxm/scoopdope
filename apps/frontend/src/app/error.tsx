'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { Button } from '@/components/ui/Button';

function getCurrentUserId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem('auth-storage');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const id =
      parsed?.state?.user?.id ??
      parsed?.user?.id ??
      parsed?.state?.userId ??
      parsed?.userId;
    return id != null ? String(id) : undefined;
  } catch {
    return undefined;
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const userId = getCurrentUserId();
    if (userId) {
      Sentry.setUser({ id: userId });
    }

    const errorInfo = {
      componentStack: error.stack ?? 'No stack trace available',
      digest: error.digest,
    };

    Sentry.captureException(error, {
      extra: errorInfo,
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    });
  }, [error]);

  const reportIssue = () => {
    const subject = encodeURIComponent('Error Report from Scoopdope App');
    const body = encodeURIComponent(
      `Error Details:\n${error?.message || 'Unknown error'}\n\nStack Trace:\n${error?.stack || 'No stack trace'}\n\nPlease describe what you were doing when this error occurred:`
    );
    window.location.href = `mailto:support@Scoopdope.com?subject=${subject}&body=${body}`;
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <div className="text-6xl mb-6">⚠️</div>
      <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
      <p className="text-gray-500 mb-6 max-w-md">
        An unexpected error occurred. You can try again or go back to the home page.
      </p>
      {error?.message && (
        <p className="text-xs text-gray-400 bg-gray-100 rounded px-3 py-2 mb-6 max-w-md break-all">
          {error.message}
        </p>
      )}
      <div className="flex gap-3 flex-wrap justify-center">
        <Button onClick={reset}>Try Again</Button>
        <Button variant="outline" onClick={() => (window.location.href = '/')}>
          Go Home
        </Button>
        <Button variant="secondary" onClick={reportIssue}>
          Report Issue
        </Button>
      </div>
    </main>
  );
}
