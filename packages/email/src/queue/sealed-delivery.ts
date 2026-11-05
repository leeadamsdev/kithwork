import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { openMessage } from "../crypto.js";
import type { EmailMessage } from "../message.js";
import type { EmailWorkerOptions } from "./options.js";

export async function deliverSealedEmail(
  job: Job<unknown>,
  key: Buffer,
  options: Pick<EmailWorkerOptions, "deliver" | "onEvent">,
) {
  const envelope = z
    .object({ sealed: z.unknown(), requestId: z.uuid().optional() })
    .safeParse(job.data);
  const fields = {
    jobId: job.id!,
    attempt: job.attemptsMade + 1,
    ...(envelope.success && envelope.data.requestId
      ? { requestId: envelope.data.requestId }
      : {}),
  };
  let message: EmailMessage;
  try {
    if (!envelope.success) throw new Error("Invalid envelope");
    message = openMessage(envelope.data.sealed, key);
  } catch {
    await job.updateData({});
    throw new UnrecoverableError("Invalid email payload");
  }
  if (message.expiresAt <= Date.now()) {
    await job.updateData({});
    options.onEvent({ event: "expired", ...fields });
    return;
  }
  // Classify failures without retaining SMTP error objects, which may contain links or credentials.
  const failure = await options.deliver(message, job.id!).then(
    () => undefined,
    (error: unknown) => {
      // A permanently rejected SMTP recipient will not succeed on retry.
      const permanent =
        error instanceof Error &&
        "responseCode" in error &&
        typeof error.responseCode === "number" &&
        error.responseCode >= 500 &&
        error.responseCode <= 599;
      return { permanent };
    },
  );
  if (failure) {
    if (failure.permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1))
      await job.updateData({});
    options.onEvent({ event: "failed", ...fields });
    if (failure.permanent)
      throw new UnrecoverableError("Email delivery rejected");
    throw new Error("Email delivery failed");
  }
  // Retain only non-sensitive completion metadata for bounded deduplication.
  await job.updateData({});
  options.onEvent({ event: "delivered", ...fields });
}
