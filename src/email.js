// Optional email notifications through Resend (free tier: 3,000 emails/month).
// If RESEND_API_KEY or FROM_EMAIL is missing, emails are skipped and
// everything is still visible in the owner dashboard.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function sendEmail(env, to, subject, lines) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL || !to) return { skipped: true };
  if (env.ENVIRONMENT === "staging") subject = `[TEST] ${subject}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#12363a">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text: lines.join("\n\n") })
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false };
  }
}

export const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
