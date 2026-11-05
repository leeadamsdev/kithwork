import type { createOutboxStore } from "./store.js";
export interface RelayOptions {
  store: ReturnType<typeof createOutboxStore>;
  publish: (reference: {
    id: string;
    expiresAt: number;
    requestId?: string;
  }) => Promise<void>;
  onError: (event: {
    phase: "publication" | "poll";
    outboxId?: string;
  }) => void;
  pollIntervalMs?: number;
}

export async function publishOutboxBatch(
  { store, publish, onError }: RelayOptions,
  signal?: AbortSignal,
): Promise<number> {
  const claims = await store.claimPublication();
  // Keep worst-case queue IO below the publication lease; never hold PG locks across it.
  for (let index = 0; index < claims.length && !signal?.aborted; index += 2) {
    await Promise.all(
      claims.slice(index, index + 2).map(async (claim) => {
        try {
          await publish({
            id: claim.id,
            expiresAt: claim.expiresAt,
            ...(claim.requestId ? { requestId: claim.requestId } : {}),
          });
          await store.publicationSucceeded(claim);
        } catch {
          await store.publicationFailed(claim);
          onError({ phase: "publication", outboxId: claim.id });
        }
      }),
    );
  }
  return claims.length;
}
