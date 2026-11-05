import { createElement as h } from "react";
import {
  Html,
  Head,
  Body,
  Heading,
  Text,
  Link,
  render,
  toPlainText,
} from "react-email";
import type { EmailMessage } from "../message.js";

export async function renderEmail(message: EmailMessage) {
  const subject =
    message.kind === "verification"
      ? "Verify your Kithwork email"
      : message.kind === "password-reset"
        ? "Reset your Kithwork password"
        : "You’re invited to Kithwork";
  const description =
    message.kind === "verification"
      ? "Verify your email address to continue setting up your account."
      : message.kind === "password-reset"
        ? "Use this link to choose a new password. If you did not request this, you can ignore this email."
        : `You have been invited to join ${message.organisationName} on Kithwork.`;
  const action =
    message.kind === "verification"
      ? "Verify email"
      : message.kind === "password-reset"
        ? "Reset password"
        : "View invitation";
  const html = await render(
    h(
      Html,
      { lang: "en" },
      h(Head),
      h(
        Body,
        null,
        h(Heading, null, subject),
        h(Text, null, description),
        h(Link, { href: message.url }, action),
        h(
          Text,
          null,
          "This link expires. If it has expired, request a new one.",
        ),
      ),
    ),
  );
  return { subject, html, text: toPlainText(html) };
}
