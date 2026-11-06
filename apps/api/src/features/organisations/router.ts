import {
  createOrganisationInputSchema,
  organisationInputSchema,
  organisationPageInputSchema,
  organisationPageSchema,
  organisationSchema,
  updateOrganisationInputSchema,
} from "@kithwork/contracts";
import { z } from "zod";
import {
  authenticatedProcedure,
  router,
} from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "./procedure.js";
import { membersRouter } from "./members-router.js";
import { listOrganisations } from "./queries.js";
import { createOrganisation, updateOrganisation } from "./commands.js";
import { removeMember } from "./members.js";
import { invitationsRouter } from "./invitations/router.js";
import { teamsRouter } from "../teams/router.js";
import { projectsRouter } from "../projects/router.js";

const successSchema = z.strictObject({ success: z.literal(true) });

export const organisationsRouter = router({
  create: authenticatedProcedure
    .input(createOrganisationInputSchema)
    .output(organisationSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.consumeOrganisationCreationLimit(ctx.user.id);
      const result = await createOrganisation(ctx.db, ctx.user.id, input.name);
      ctx.log.info(
        {
          organisationId: result.id,
          actorId: ctx.user.id,
          action: "organisation.created",
        },
        "Organisation access changed",
      );
      return result;
    }),
  list: authenticatedProcedure
    .input(organisationPageInputSchema)
    .output(organisationPageSchema)
    .query(({ ctx, input }) => listOrganisations(ctx.db, ctx.user.id, input)),
  get: organisationProcedure
    .input(organisationInputSchema)
    .output(organisationSchema)
    .query(({ ctx }) => ctx.organisation),
  update: organisationProcedure
    .input(updateOrganisationInputSchema)
    .output(organisationSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateOrganisation(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        input.name,
      );
      ctx.log.info(
        { action: "organisation.updated" },
        "Organisation access changed",
      );
      return result;
    }),
  members: membersRouter,
  invitations: invitationsRouter,
  teams: teamsRouter,
  projects: projectsRouter,
  leave: organisationProcedure
    .input(organisationInputSchema)
    .output(successSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await removeMember(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        ctx.user.id,
        true,
      );
      ctx.log.info(
        { action: "membership.left" },
        "Organisation access changed",
      );
      return result;
    }),
});
