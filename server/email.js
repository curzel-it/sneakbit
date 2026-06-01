// Transactional email via the SMTP2GO REST API (fetch — no SMTP client
// dependency). Configure with SMTP2GO_API_KEY + SMTP_FROM. When either is
// missing the function no-ops and logs the payload, so local dev (and the
// e2e suite) works without real email — the forgot-password flow is still
// exercisable by reading the logged reset link.

const SMTP2GO_ENDPOINT = "https://api.smtp2go.com/v3/email/send";

export function isEmailConfigured(env = process.env) {
  return !!(env.SMTP2GO_API_KEY && env.SMTP_FROM);
}

export async function sendEmail({ to, subject, html, text }, env = process.env) {
  if (!isEmailConfigured(env)) {
    // Dev / unconfigured: surface enough to follow the flow by hand without
    // leaking a configured secret. The body is logged so a developer can
    // copy a reset link out of the server log.
    console.warn("[email] not configured — skipping send", { to, subject });
    if (html || text) console.warn("[email] body:", text || html);
    return { ok: false, skipped: true };
  }
  try {
    const res = await fetch(SMTP2GO_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: env.SMTP2GO_API_KEY,
        sender: env.SMTP_FROM,
        to: [to],
        subject,
        html_body: html,
        text_body: text || stripHtml(html),
      }),
    });
    if (!res.ok) {
      console.error("[email] send failed", { status: res.status });
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    // Never let an email failure bubble into the request — the caller
    // (forgot-password) always returns 200 regardless.
    console.error("[email] send threw", { err: err?.message || String(err) });
    return { ok: false, error: true };
  }
}

function stripHtml(html) {
  if (!html) return "";
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
