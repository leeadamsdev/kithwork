import { organisationInputSchema } from "@kithwork/contracts";
import { z } from "zod";
import { authenticatedProcedure } from "../../platform/trpc/procedures.js";
import { loadOrganisationAccess } from "./access.js";
export const organisationProcedure = authenticatedProcedure
  .input(z.object(organisationInputSchema.shape))
  .use(async ({ ctx, input, next }) => {
    const organisation = await loadOrganisationAccess(
      ctx.db,
      ctx.user.id,
      input.organisationId,
    );
    return next({
      ctx: {
        organisation,
        log: ctx.log.child({
          organisationId: organisation.id,
          actorId: ctx.user.id,
        }),
      },
    });
  });
