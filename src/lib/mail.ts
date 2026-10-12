import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email.
 *
 * Deliberately degrades instead of failing: with no SMTP configured the
 * message is written to the server log. That keeps password reset testable on
 * a fresh clone with no credentials, and means a self-hosted install without
 * mail is inconvenient rather than broken -- an admin can read the link out of
 * the logs.
 *
 * Anything security-sensitive that depends on delivery (a reset link) must
 * therefore never *assume* delivery. The reset endpoint returns the same
 * response whether or not mail went out, so a failure here cannot be used to
 * probe for accounts.
 */

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

const globalForMail = globalThis as unknown as { __thrumMailer?: Transporter | null };

function transport(): Transporter | null {
  if (globalForMail.__thrumMailer !== undefined) return globalForMail.__thrumMailer;

  const host = process.env.SMTP_HOST;
  if (!host) {
    globalForMail.__thrumMailer = null;
    return null;
  }

  const port = Number(process.env.SMTP_PORT ?? 587);

  globalForMail.__thrumMailer = nodemailer.createTransport({
    host,
    port,
    // Implicit TLS on 465, STARTTLS elsewhere. Overridable because some relays
    // disagree about which they want.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "1" : port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASSWORD
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
  });

  return globalForMail.__thrumMailer;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

/**
 * Sends a message, or logs it when mail is not configured.
 *
 * Never throws: a transport failure is logged and swallowed, because every
 * caller is on a path where the HTTP response must not reveal whether delivery
 * succeeded.
 */
export async function sendMail(mail: Mail): Promise<void> {
  const mailer = transport();

  if (!mailer) {
    console.log(
      [
        "",
        "─".repeat(72),
        "  EMAIL NOT CONFIGURED -- printing message instead of sending it.",
        "  Set SMTP_HOST (see .env.example) to deliver mail for real.",
        "─".repeat(72),
        `  To:      ${mail.to}`,
        `  Subject: ${mail.subject}`,
        "",
        mail.text.replace(/^/gm, "  "),
        "─".repeat(72),
        "",
      ].join("\n"),
    );
    return;
  }

  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM ?? "Thrum <no-reply@localhost>",
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  } catch (err) {
    console.error("[mail] delivery failed:", err instanceof Error ? err.message : err);
  }
}

/** Absolute URL for links in email, from AUTH_URL. */
export function appUrl(path: string): string {
  const base = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
