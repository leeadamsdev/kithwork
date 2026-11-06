import {
  changeMemberRoleInputSchema,
  memberInputSchema,
  memberPageInputSchema,
  memberPageSchema,
  organisationMemberSchema,
} from "@kithwork/contracts";
import { z } from "zod";
import { router } from "../../platform/trpc/procedures.js";
import { organisationProcedure } from "./procedure.js";
import { listMembers } from "./queries.js";
import { changeMemberRole, removeMember } from "./members.js";
const successSchema = z.strictObject({ success: z.literal(true) });
export const membersRouter = router({
  list: organisationProcedure
    .input(memberPageInputSchema)
    .output(memberPageSchema)
    .query(({ ctx, input }) =>
      listMembers(ctx.db, ctx.user.id, ctx.organisation.id, input),
    ),
  changeRole: organisationProcedure
    .input(changeMemberRoleInputSchema)
    .output(organisationMemberSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await changeMemberRole(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        input.userId,
        input.role,
      );
      ctx.log.info(
        {
          action: "membership.role_changed",
          targetUserId: input.userId,
          role: input.role,
        },
        "Organisation access changed",
      );
      return result;
    }),
  remove: organisationProcedure
    .input(memberInputSchema)
    .output(successSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await removeMember(
        ctx.db,
        ctx.user.id,
        input.organisationId,
        input.userId,
      );
      ctx.log.info(
        { action: "membership.removed", targetUserId: input.userId },
        "Organisation access changed",
      );
      return result;
    }),
});
