import { expect, it } from "vitest";
import fc from "fast-check";
import * as c from "../../src/index.js";

const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const link = (id: string, label = "Alice") =>
  `[${label}](kithwork://user/${id})`;

it("extracts canonical identities from inline and reference links, independently of display labels", () => {
  const body = `${link(alice.toUpperCase(), "Forged Bob")} **${link(bob)}** ${link(alice)}\n\n[Reference][ Person ]\n\n[person]: kithwork://user/${bob} "Title"`;
  expect(c.extractCommentMentions(body)).toEqual([alice, bob]);
  expect(
    c.extractCommentMentions(`[Alice][]\n\n[alice]: kithwork://user/${alice}`),
  ).toEqual([alice]);
  expect(
    c.extractCommentMentions(`[Alice]\n\n[alice]: kithwork://user/${alice}`),
  ).toEqual([alice]);
});

it("ignores Markdown lookalikes in code, escaped text, HTML, images and link titles", () => {
  const body = [
    `\`${link(alice)}\``,
    `\`\`\`md\n${link(alice)}\n\`\`\``,
    `    ${link(alice)}`,
    `\\[Alice](kithwork://user/${alice})`,
    `<a href="kithwork://user/${alice}">Alice</a>`,
    `<div>\n${link(alice)}\n</div>`,
    `![Alice](kithwork://user/${alice})`,
    `[Ordinary](https://example.test "kithwork://user/${alice}")`,
    `[unused]: kithwork://user/${alice}`,
  ].join("\n\n");
  expect(c.extractCommentMentions(body)).toEqual([]);
});

it("rejects malformed reserved destinations and more than twenty distinct people while inspecting legacy text leniently", () => {
  for (const destination of [
    "kithwork://user/not-a-uuid",
    `kithwork://user/${alice}?q=x`,
    `kithwork://user/${alice}#x`,
    `kithwork://user/${alice}/`,
    "kithwork:broken",
    "kithwork://other/id",
    `kithwork://user/%30${alice.slice(1)}`,
  ]) {
    expect(
      c.inspectCommentMentionLinks(`[A](${destination})`).invalidDestinations,
    ).toEqual([destination]);
    expect(() => c.extractCommentMentions(`[A](${destination})`)).toThrow();
  }
  const ids = Array.from(
    { length: 21 },
    (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  );
  expect(
    c.extractCommentMentions(
      ids
        .slice(0, 20)
        .map((id) => link(id))
        .join(" "),
    ),
  ).toHaveLength(20);
  const body = ids.map((id) => link(id)).join(" ");
  expect(c.inspectCommentMentionLinks(body).userIds).toHaveLength(21);
  expect(() => c.extractCommentMentions(body)).toThrow();
  expect(
    c.extractCommentMentions(
      Array.from({ length: 30 }, () => link(alice)).join(" "),
    ),
  ).toEqual([alice]);
});

it("formats arbitrary display labels without allowing them to change or add mention identities", () => {
  const labels = fc
    .array(
      fc.constantFrom(
        "a",
        " ",
        "]",
        "[",
        "\\",
        "`",
        "*",
        "_",
        "!",
        "<",
        ">",
        "(",
        ")",
        "\r",
        "\n",
        "é",
        "😀",
      ),
      { maxLength: 80 },
    )
    .map((parts) => parts.join(""));
  fc.assert(
    fc.property(labels, (label) => {
      const formatted = c.formatUserMention(alice.toUpperCase(), label);
      expect(formatted).not.toMatch(/[\r\n]/);
      expect(c.extractCommentMentions(formatted)).toEqual([alice]);
    }),
    { numRuns: 200 },
  );
  expect(
    c.extractCommentMentions(
      c.formatUserMention(alice, `Alice](kithwork://user/${bob}) [Bob`),
    ),
  ).toEqual([alice]);
});
