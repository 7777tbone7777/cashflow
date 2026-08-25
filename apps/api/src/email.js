/**
 * Outbound email, via Resend.
 *
 * A plain HTTPS call rather than the SDK: one endpoint is used, and an email
 * dependency is another supply chain to watch for no benefit.
 *
 * Nothing here throws into a request. Sending is a side effect of inviting
 * somebody, not the point of it — if mail is misconfigured the invitation
 * should still exist and the link should still be shown, rather than the whole
 * action failing and leaving a half-made invite behind. Callers get told
 * whether it went, and say so in the interface.
 */

const API = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Why mail is off, in words a person can act on. */
export function emailStatus() {
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    return { configured: true, from: process.env.EMAIL_FROM };
  }
  const missing = [
    !process.env.RESEND_API_KEY && 'RESEND_API_KEY',
    !process.env.EMAIL_FROM && 'EMAIL_FROM',
  ].filter(Boolean);
  return { configured: false, missing };
}

export async function sendEmail({ to, subject, text, html, replyTo }) {
  if (!emailConfigured()) {
    return { sent: false, reason: 'email is not configured on this deployment' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      // Logged, not raised. The caller has already done the thing that matters.
      console.error(`[email] ${response.status} sending to ${to}: ${detail}`);
      return { sent: false, reason: `mail provider returned ${response.status}` };
    }
    return { sent: true };
  } catch (error) {
    console.error(`[email] failed sending to ${to}: ${error.message}`);
    return {
      sent: false,
      reason: error.name === 'AbortError' ? 'mail provider timed out' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

const SIGNATURE = '\n\n—\nCashflow — production finance\n';

function layout(heading, body, action) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;padding:32px 16px;`
    + `font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c2430">`
    + `<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e7ec;`
    + `border-radius:12px;padding:28px">`
    + `<p style="margin:0 0 6px;color:#4b9fea;letter-spacing:.16em;text-transform:uppercase;`
    + `font-size:11px">Cashflow</p>`
    + `<h1 style="margin:0 0 14px;font-size:20px">${heading}</h1>`
    + body
    + (action
      ? `<p style="margin:22px 0"><a href="${action.url}" style="background:#2f6ea8;color:#fff;`
        + `text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block;`
        + `font-weight:600">${action.label}</a></p>`
        + `<p style="margin:0;color:#6b7684;font-size:12px;word-break:break-all">`
        + `Or paste this into your browser:<br>${action.url}</p>`
      : '')
    + `<p style="margin:22px 0 0;border-top:1px solid #e3e7ec;padding-top:14px;color:#6b7684;`
    + `font-size:12px">Cashflow — production finance</p>`
    + `</div></body></html>`;
}

const p = (text) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.55">${text}</p>`;

/** Somebody has been invited to the application, without a show attached. */
export function inviteEmail({ link, invitedBy, expiresAt }) {
  const who = invitedBy.name || invitedBy.email;
  const until = new Date(expiresAt).toDateString();
  return {
    subject: `${who} invited you to Cashflow`,
    text: `${who} (${invitedBy.email}) has invited you to Cashflow, where a production `
      + `budget becomes a weekly cash flow and hot cost day sheets.\n\n`
      + `Create your account:\n${link}\n\n`
      + `The link works until ${until} and can only be used once. Your work is private `
      + `to your own account.${SIGNATURE}`,
    html: layout('You have been invited',
      p(`<strong>${who}</strong> (${invitedBy.email}) has invited you to Cashflow, where a `
        + `production budget becomes a weekly cash flow and hot cost day sheets.`)
      + p(`The link works until <strong>${until}</strong> and can only be used once. `
        + `Your work is private to your own account.`),
      { url: link, label: 'Create your account' }),
  };
}

/** Somebody has been put on a specific show. */
export function shareEmail({ link, invitedBy, production, role, expiresAt }) {
  const who = invitedBy.name || invitedBy.email;
  const until = new Date(expiresAt).toDateString();
  const can = role === 'editor'
    ? 'upload budgets and generate documents'
    : 'read what has been generated';
  return {
    subject: `${who} added you to ${production}`,
    text: `${who} (${invitedBy.email}) has added you to "${production}" on Cashflow, `
      + `where you can ${can}.\n\n`
      + `This link creates your account and puts you on the show:\n${link}\n\n`
      + `It works until ${until} and can only be used once. You will see this show `
      + `and nothing else.${SIGNATURE}`,
    html: layout(`You have been added to ${production}`,
      p(`<strong>${who}</strong> (${invitedBy.email}) has added you to `
        + `<strong>${production}</strong> on Cashflow, where you can ${can}.`)
      + p(`The link works until <strong>${until}</strong> and can only be used once. `
        + `You will see this show and nothing else.`),
      { url: link, label: 'Open the show' }),
  };
}

export function passwordResetEmail({ link, expiresAt }) {
  const until = new Date(expiresAt).toLocaleString();
  return {
    subject: 'Reset your Cashflow password',
    text: `Somebody asked to reset the password on this Cashflow account.\n\n`
      + `Set a new one:\n${link}\n\n`
      + `The link expires at ${until} and can only be used once. Choosing a new `
      + `password signs out every session.\n\n`
      + `If this was not you, nothing has changed and you can ignore this.${SIGNATURE}`,
    html: layout('Reset your password',
      p('Somebody asked to reset the password on this Cashflow account.')
      + p(`The link expires at <strong>${until}</strong> and can only be used once. `
        + `Choosing a new password signs out every session.`)
      + p('If this was not you, nothing has changed and you can ignore this.'),
      { url: link, label: 'Set a new password' }),
  };
}
