// Validate an expense from the dashboard form
export function parseExpense(body) {
  const name = String(body?.name || "").trim().slice(0, 80);
  const amount = Number(body?.amount);
  const kind = body?.kind === "once" ? "once" : "monthly";
  const start = String(body?.startMonth || "");
  const end = body?.endMonth ? String(body.endMonth) : null;
  if (!name) return { ok: false, error: "Name the expense, e.g. HOA dues." };
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return { ok: false, error: "Enter an amount in dollars." };
  if (!/^\d{4}-\d{2}$/.test(start)) return { ok: false, error: "Pick the month it starts." };
  if (end && (!/^\d{4}-\d{2}$/.test(end) || end < start)) return { ok: false, error: "The end month must be after the start month." };
  return { ok: true, expense: { name, amountCents: Math.round(amount * 100), kind, start, end: kind === "once" ? null : end } };
}
