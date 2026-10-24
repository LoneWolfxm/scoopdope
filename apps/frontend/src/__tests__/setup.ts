import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock @sentry/nextjs globally so Error Boundary tests (and any other tests)
// can assert on Sentry calls without hitting the real SDK.
vi.mock('@sentry/nextjs', () => {
  const captureException = vi.fn();
  const setUser = vi.fn();
  const setTag = vi.fn();
  const setContext = vi.fn();
  const withScope = vi.fn((callback: (scope: unknown) => void) => {
    const scope = {
      setUser,
      setTag,
      setContext,
      setExtra: vi.fn(),
      setLevel: vi.fn(),
    };
    callback(scope);
  });
  const init = vi.fn();
  const captureMessage = vi.fn();
  const addBreadcrumb = vi.fn();

  return {
    init,
    captureException,
    captureMessage,
    setUser,
    setTag,
    setContext,
    withScope,
    addBreadcrumb,
    default: {
      init,
      captureException,
      captureMessage,
      setUser,
      setTag,
      setContext,
      withScope,
      addBreadcrumb,
    },
  };
});