import {
  addTeamMemberInputSchema,
  changeTeamMemberRoleInputSchema,
  teamMemberInputSchema,
  teamMemberPageInputSchema,
  teamMemberPageSchema,
  teamMemberSchema,
} from "@kithwork/contracts";
import { z } from "zod";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "../organisations/procedure.js";
import { listTeamMembers } from "./member-queries.js";
import {
  addTeamMember,
  changeTeamMemberRole,
  removeTeamMember,
} from "./members.js";
export const teamMembersRouter = router({
  list: organisationProcedure
    .input(teamMemberPageInputSchema)
    .output(teamMemberPageSchema)
    .query(({ ctx, input }) => listTeamMembers(ctx.db, ctx.user.id, input)),
  add: organisationProcedure
    .input(addTeamMemberInputSchema)
    .output(teamMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await addTeamMember(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "team.member_added",
          teamId: input.teamId,
          targetUserId: input.userId,
        },
        "Team membership changed",
      );
      return result;
    }),
  changeRole: organisationProcedure
    .input(changeTeamMemberRoleInputSchema)
    .output(teamMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await changeTeamMemberRole(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "team.member_role_changed",
          teamId: input.teamId,
          targetUserId: input.userId,
        },
        "Team membership changed",
      );
      return result;
    }),
  remove: organisationProcedure
    .input(teamMemberInputSchema)
    .output(z.strictObject({ success: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const result = await removeTeamMember(ctx.db, ctx.user.id, input);
      ctx.log.info(
        {
          action: "team.member_removed",
          teamId: input.teamId,
          targetUserId: input.userId,
        },
        "Team membership changed",
      );
      return result;
    }),
});
