import {
  createTeamInputSchema,
  teamInputSchema,
  teamPageInputSchema,
  teamPageSchema,
  teamSchema,
  teamMemberSchema,
  updateTeamInputSchema,
  setTeamVisibilityInputSchema,
  versionedTeamInputSchema,
} from "@kithwork/contracts";
import { z } from "zod";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "../organisations/procedure.js";
import { createTeam, updateTeam } from "./commands.js";
import { listTeams, getTeam } from "./queries.js";
import { setTeamArchived, setTeamVisibility } from "./lifecycle.js";
import { isOrganisationAdministrator } from "./policies.js";
import { teamForbidden } from "./errors.js";
import { teamMembersRouter } from "./members-router.js";
import { joinTeam, leaveTeam } from "./members.js";
import { workflowRouter } from "../workflows/router.js";

export const teamsRouter = router({
  workflow: workflowRouter,
  members: teamMembersRouter,
  join: organisationProcedure
    .input(teamInputSchema)
    .output(teamMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await joinTeam(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "team.joined", teamId: input.teamId },
        "Team membership changed",
      );
      return result;
    }),
  leave: organisationProcedure
    .input(teamInputSchema)
    .output(z.strictObject({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const result = await leaveTeam(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "team.left", teamId: input.teamId },
        "Team membership changed",
      );
      return result;
    }),
  create: organisationProcedure
    .input(createTeamInputSchema)
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isOrganisationAdministrator(ctx.organisation.role))
        throw teamForbidden();
      await ctx.consumeTeamCreationLimit(ctx.user.id, input.organisationId);
      const result = await createTeam(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "team.created", teamId: result.id },
        "Team changed",
      );
      return result;
    }),
  list: organisationProcedure
    .input(teamPageInputSchema)
    .output(teamPageSchema)
    .query(({ ctx, input }) => listTeams(ctx.db, ctx.user.id, input)),
  get: organisationProcedure
    .input(teamInputSchema)
    .output(teamSchema)
    .query(({ ctx, input }) => getTeam(ctx.db, ctx.user.id, input)),
  update: organisationProcedure
    .input(updateTeamInputSchema)
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await updateTeam(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "team.updated", teamId: result.id },
        "Team changed",
      );
      return result;
    }),
  setVisibility: organisationProcedure
    .input(setTeamVisibilityInputSchema)
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setTeamVisibility(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "team.visibility_changed", teamId: result.id },
        "Team changed",
      );
      return result;
    }),
  archive: organisationProcedure
    .input(versionedTeamInputSchema)
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setTeamArchived(ctx.db, ctx.user.id, input, true);
      ctx.log.info(
        { action: "team.archived", teamId: result.id },
        "Team changed",
      );
      return result;
    }),
  restore: organisationProcedure
    .input(versionedTeamInputSchema)
    .output(teamSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await setTeamArchived(ctx.db, ctx.user.id, input, false);
      ctx.log.info(
        { action: "team.restored", teamId: result.id },
        "Team changed",
      );
      return result;
    }),
});
