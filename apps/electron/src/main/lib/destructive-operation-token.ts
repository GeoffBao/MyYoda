import { randomUUID } from 'node:crypto'

export type DestructiveOperationKind = 'project-purge' | 'task-purge'

interface PendingConfirmation {
  kind: DestructiveOperationKind
  scope: string
  fingerprint: string
  expiresAt: number
}

const TOKEN_TTL_MS = 5 * 60 * 1000
const pendingConfirmations = new Map<string, PendingConfirmation>()

function pruneExpired(now = Date.now()): void {
  for (const [token, confirmation] of pendingConfirmations) {
    if (confirmation.expiresAt <= now) pendingConfirmations.delete(token)
  }
}

export function issueDestructiveOperationToken(
  kind: DestructiveOperationKind,
  scope: string,
  fingerprint: string,
  now = Date.now(),
): string {
  pruneExpired(now)
  const token = randomUUID()
  pendingConfirmations.set(token, {
    kind,
    scope,
    fingerprint,
    expiresAt: now + TOKEN_TTL_MS,
  })
  return token
}

export function consumeDestructiveOperationToken(
  token: unknown,
  kind: DestructiveOperationKind,
  scope: string,
  fingerprint: string,
  now = Date.now(),
): boolean {
  pruneExpired(now)
  if (typeof token !== 'string' || token.length === 0) return false
  const confirmation = pendingConfirmations.get(token)
  if (!confirmation) return false
  if (
    confirmation.kind !== kind
    || confirmation.scope !== scope
    || confirmation.fingerprint !== fingerprint
  ) return false

  pendingConfirmations.delete(token)
  return true
}
