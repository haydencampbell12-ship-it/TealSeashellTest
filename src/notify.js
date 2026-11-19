// Optional push notifications to the owner's phone through ntfy (https://ntfy.sh, free).
// Install the ntfy app, subscribe to the same topic name as the NTFY_TOPIC secret, and
// every new request or payment arrives as a push. The topic name works like a password:
// anyone who knows it can read the pushes, so keep it long and random and store it as a secret.
// If NTFY_TOPIC is missing, pushes are skipped and everything is still in the dashboard.

export async function sendPush(env, { title, message, tags = [], priority = 3, path = "/admin.html" }) {
  if (!env.NTFY_TOPIC) return { skipped: true };
  if (env.ENVIRONMENT === "staging") title = `[TEST] ${title}`;
  const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
  const site = (env.SITE_URL || "").replace(/\/$/, "");
  const body = { topic: env.NTFY_TOPIC, title: title.slice(0, 250), message: message.slice(0, 3500), tags, priority };
  if (site) body.click = site + path;
  try {
    // JSON publishing keeps dashes, accents and emoji intact (header publishing can't)
    const res = await fetch(server, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
