import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@kithwork/api/router";
import type { SystemInfo } from "@kithwork/contracts";

export const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/trpc" })],
});
export const getSystemInfo: () => Promise<SystemInfo> = () =>
  client.system.info.query();
