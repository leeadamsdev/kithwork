import nodemailer from "nodemailer";
import type { SMTPPoolOptions } from "nodemailer/lib/smtp-pool";
import type { EmailMessage } from "../message.js";
import { renderEmail } from "./render.js";

export function createSmtpDelivery(options: {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  from: string;
  maxConnections?: number;
  auth?: { user: string; pass: string };
}) {
  const { from, maxConnections = 2, ...smtp } = options;
  const transportOptions: SMTPPoolOptions & { pool: true } = {
    ...smtp,
    pool: true,
    maxConnections,
    maxMessages: 100,
    maxRequeues: 0,
    connectionTimeout: 2000,
    greetingTimeout: 2000,
    socketTimeout: 5000,
    logger: false,
    debug: false,
  };
  const transport = nodemailer.createTransport(transportOptions, {
    from,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    deliver: async (message: EmailMessage, id: string) => {
      const rendered = await renderEmail(message);
      const result = await transport.sendMail({
        from: options.from,
        to: message.to,
        ...rendered,
        messageId: `<${id}@kithwork>`,
      });
      if (result.accepted.length !== 1 || result.rejected.length !== 0)
        throw new Error("Email delivery rejected");
    },
    close: () => {
      transport.close();
    },
  };
}
