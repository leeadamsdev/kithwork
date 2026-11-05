import { authenticatedUserSchema, systemInfoSchema } from "@kithwork/contracts";
import { apiInfo } from "../../features/system/metadata.js";
import { organisationsRouter } from "../../features/organisations/router.js";
import {
  authenticatedProcedure,
  publicProcedure,
  router,
} from "./procedures.js";

export const appRouter = router({
  auth: router({
    me: authenticatedProcedure
      .output(authenticatedUserSchema)
      .query(({ ctx }) => ctx.user),
  }),
  system: router({
    info: publicProcedure.output(systemInfoSchema).query(() => apiInfo),
  }),
  organisations: organisationsRouter,
});
export type AppRouter = typeof appRouter;
