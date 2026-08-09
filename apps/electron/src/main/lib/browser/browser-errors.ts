/**
 * Browser 自动化错误处理（移植自 synara hostErrors.ts，精简）。
 */

import type {
  BrowserAutomationError,
  BrowserAutomationErrorInput,
  BrowserMcpToolErrorEnvelope,
} from './browser-types'

const DEFAULT_PHASE = 'runtime'

export function makeBrowserMcpToolErrorEnvelope(input: BrowserAutomationErrorInput): BrowserMcpToolErrorEnvelope {
  const error: BrowserAutomationError = {
    code: input.code,
    retryable: input.retryable ?? false,
    phase: input.phase ?? DEFAULT_PHASE,
    effectMayHaveCommitted: input.effectMayHaveCommitted ?? false,
    message: input.message ?? input.code,
    ...(input.tabId ? { tabId: input.tabId } : {}),
  }
  return { error }
}

export class BrowserAutomationHostError extends Error {
  readonly envelope: BrowserMcpToolErrorEnvelope

  constructor(input: BrowserAutomationErrorInput) {
    const envelope = makeBrowserMcpToolErrorEnvelope(input)
    super(envelope.error.message)
    this.name = 'BrowserAutomationHostError'
    this.envelope = envelope
  }

  get browserError(): BrowserAutomationError {
    return this.envelope.error
  }
}

export function browserHostError(input: BrowserAutomationErrorInput): never {
  throw new BrowserAutomationHostError(input)
}

export const asBrowserAutomationHostError = (
  error: unknown,
  fallback: BrowserAutomationErrorInput,
): BrowserAutomationHostError =>
  error instanceof BrowserAutomationHostError ? error : new BrowserAutomationHostError(fallback)
