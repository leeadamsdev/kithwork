import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { z } from "zod";
import { entityIdSchema } from "../../identifiers.js";

export const maxCommentMentions = 20;

export function inspectCommentMentionLinks(markdown: string) {
  const pending: Nodes[] = [fromMarkdown(markdown)];
  const nodes: Nodes[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    nodes.push(node);
    if ("children" in node) pending.push(...[...node.children].reverse());
  }
  const definitions = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node.url);
  }
  const userIds = new Set<string>();
  const invalidDestinations = new Set<string>();
  for (const node of nodes) {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier)
          : undefined;
    if (!url || !/^kithwork:/i.test(url)) continue;
    const match = /^kithwork:\/\/user\/([^/?#]+)$/i.exec(url);
    const id = entityIdSchema.safeParse(match?.[1]);
    if (id.success) userIds.add(id.data.toLowerCase());
    else invalidDestinations.add(url);
  }
  return {
    userIds: [...userIds],
    invalidDestinations: [...invalidDestinations],
  };
}

export const commentMentionIdsSchema = z.string().transform((markdown, ctx) => {
  const result = inspectCommentMentionLinks(markdown);
  if (result.invalidDestinations.length) {
    ctx.addIssue({ code: "custom", message: "Invalid mention destination" });
    return z.NEVER;
  }
  if (result.userIds.length > maxCommentMentions) {
    ctx.addIssue({
      code: "custom",
      message: `A comment may mention at most ${maxCommentMentions} people`,
    });
    return z.NEVER;
  }
  return result.userIds;
});

export const extractCommentMentions = (markdown: string): string[] =>
  commentMentionIdsSchema.parse(markdown);

export function formatUserMention(userId: string, label: string) {
  const id = entityIdSchema.parse(userId).toLowerCase();
  const escaped = label
    .replace(/[\r\n]+/g, " ")
    .trim()
    .replace(/[\\[\]`*_!<>]/g, "\\$&");
  return `[${escaped}](kithwork://user/${id})`;
}
