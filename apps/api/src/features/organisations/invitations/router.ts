import {
  createInvitationInputSchema,
  invitationInputSchema,
  invitationPageInputSchema,
  invitationPageSchema,
  invitationSchema,
  invitationPreviewInputSchema,
  invitationPreviewSchema,
  acceptInvitationInputSchema,
  organisationSchema,
} from "@kithwork/contracts";
import {
  authenticatedProcedure,
  router,
} from "../../../platform/trpc/procedures.js";
import { organisationProcedure } from "../procedure.js";
import { forbidden } from "../errors.js";
import { canManageInvitations } from "./policies.js";
import { createInvitation, resendInvitation } from "./issue.js";
import { revokeInvitation } from "./cancellation.js";
import { listInvitations } from "./queries.js";
import { acceptInvitation, previewInvitation } from "./acceptance.js";

const administration = organisationProcedure.use(({ ctx, next }) => {
  if (!canManageInvitations(ctx.organisation.role)) throw forbidden();
  return next();
});

export const invitationsRouter = router({
  preview: authenticatedProcedure
    .input(invitationPreviewInputSchema)
    .output(invitationPreviewSchema)
    .query(async ({ ctx, input }) => {
      await ctx.consumeInvitationAccessLimit(ctx.user.id);
      return previewInvitation(ctx.db, ctx.user, input.invitationId);
    }),
  accept: authenticatedProcedure
    .input(acceptInvitationInputSchema)
    .output(organisationSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.consumeInvitationAccessLimit(ctx.user.id);
      const result = await acceptInvitation(ctx.db, ctx.user, input);
      ctx.log.info(
        {
          action: "invitation.accepted",
          invitationId: input.invitationId,
          organisationId: result.id,
          actorId: ctx.user.id,
        },
        "Organisation invitation accepted",
      );
      return result;
    }),
  create: administration
    .input(createInvitationInputSchema)
    .output(invitationSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.consumeInvitationSendLimit(ctx.user.id, input.organisationId);
      const result = await createInvitation(
        ctx.db,
        ctx.user.id,
        input,
        ctx.invitationEmail,
        ctx.requestId,
      );
      ctx.log.info(
        { action: "invitation.created", invitationId: result.id },
        "Organisation invitation changed",
      );
      return result;
    }),
  list: administration
    .input(invitationPageInputSchema)
    .output(invitationPageSchema)
    .query(({ ctx, input }) =>
      listInvitations(ctx.db, ctx.user.id, input.organisationId, input),
    ),
  resend: administration
    .input(invitationInputSchema)
    .output(invitationSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.consumeInvitationSendLimit(ctx.user.id, input.organisationId);
      const result = await resendInvitation(
        ctx.db,
        ctx.user.id,
        input,
        ctx.invitationEmail,
        ctx.requestId,
      );
      ctx.log.info(
        { action: "invitation.resent", invitationId: result.id },
        "Organisation invitation changed",
      );
      return result;
    }),
  revoke: administration
    .input(invitationInputSchema)
    .output(invitationSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await revokeInvitation(ctx.db, ctx.user.id, input);
      ctx.log.info(
        { action: "invitation.revoked", invitationId: result.id },
        "Organisation invitation changed",
      );
      return result;
    }),
});
