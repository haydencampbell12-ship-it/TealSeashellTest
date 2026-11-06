// The Teal Seashell — owner dashboard
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pretty = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); kids.forEach((k) => e.append(k)); return e; };
  let data = null;

  async function api(path, method = "GET", body) {
    const res = await fetch(path, { method, headers: method === "GET" ? {} : { "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body || {}), credentials: "same-origin" });
    const out = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error("Sign in again."); }
    if (!res.ok) throw new Error(out.error || "Something went wrong.");
    return out;
  }
  function toast(text, isError) {
    const t = $("toast"); t.textContent = text; t.className = "msg " + (isError ? "error" : "success"); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 6000);
  }
  function showLogin() { location.replace("/login.html"); }
  $("logout").addEventListener("click", async () => { await api("/api/admin/logout", "POST").catch(() => {}); showLogin(); });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((o) => o.setAttribute("aria-selected", String(o === t)));
    document.querySelectorAll("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    if (t.dataset.tab === "finances") window.TS_FINANCE && window.TS_FINANCE.load();
  }));

  async function load() {
    try { data = await api("/api/admin/overview"); }
    catch { return; }
    $("dash").hidden = false; $("logout").hidden = false;
    if (data.setup.environment === "staging" && !document.querySelector(".test-banner")) {
      const b = document.createElement("div"); b.className = "test-banner";
      b.textContent = "Test site. Changes here don't affect your live site or your Airbnb and VRBO calendars.";
      document.body.prepend(b);
    }
    $("whoami").textContent = data.user ? `Signed in as ${data.user}` : "";
    renderRequests(); renderCalendar(); renderSetup();
  }

  // ---- requests ----
  function renderRequests() {
    const list = $("reqList"); list.innerHTML = "";
    const pending = data.requests.filter((r) => r.status === "pending").length;
    $("pendingCount").textContent = pending ? `(${pending})` : "";
    if (!data.requests.length) {
      list.append(el("div", { className: "card" }, el("h3", { textContent: "No requests yet" }), el("p", { className: "muted", textContent: "When a guest requests dates on your site, it shows up here and you'll get an email if notifications are set up." })));
      return;
    }
    for (const r of data.requests) {
      const card = el("article", { className: "card" });
      const top = el("div", { className: "req-top" },
        el("h3", { textContent: `${pretty(r.check_in)} → ${pretty(r.check_out)}` }),
        el("span", { className: "status " + r.status, textContent: { pending: "Needs review", approved: "Awaiting payment", confirmed: "Confirmed", declined: "Declined", expired: "Payment expired", cancelled: "Cancelled" }[r.status] || r.status }));
      card.append(top);
      if (r.conflict && ["pending", "approved", "confirmed"].includes(r.status)) card.append(el("p", { className: "warn", textContent: "These dates overlap an Airbnb/VRBO reservation or a block." }));
      const dl = el("dl", { className: "kv" });
      const add = (k, v) => { if (v) dl.append(el("dt", { textContent: k }), el("dd", { textContent: v })); };
      add("Guest", `${r.name} · ${r.guests} guest${r.guests > 1 ? "s" : ""}`);
      add("Email", r.email); add("Phone", r.phone);
      add("Total", `${money(r.total_cents)} for ${r.nights} nights`);
      add("Message", r.notes);
      add("Requested", new Date(r.created_at).toLocaleString());
      if (r.status === "approved" && r.hold_expires_at) add("Hold ends", new Date(r.hold_expires_at).toLocaleString());
      card.append(dl);
      if (r.payment_url && r.status === "approved") {
        const code = el("code", { textContent: r.payment_url });
        const b = el("button", { className: "btn ghost", type: "button", textContent: "Copy payment link" });
        b.addEventListener("click", () => copy(r.payment_url));
        card.append(el("div", { className: "copy-row" }, code, b));
      }
      const acts = el("div", { className: "actions" });
      const btn = (label, action, ghost, confirmText) => {
        const b = el("button", { className: "btn" + (ghost ? " ghost" : ""), type: "button", textContent: label });
        b.addEventListener("click", async () => {
          if (confirmText && b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = confirmText; setTimeout(() => { b.dataset.armed = ""; b.textContent = label; }, 4000); return; }
          b.disabled = true;
          try {
            const out = await api(`/api/admin/requests/${r.id}/${action}`, "POST");
            toast({ approve: out.paymentUrl ? (out.emailed ? "Approved. The guest was emailed a payment link." : "Approved. Copy the payment link and send it to the guest.") : "Approved. Collect payment, then mark it paid.", decline: "Declined.", confirm: "Marked as paid. The dates are blocked.", cancel: out.note ? "Cancelled. " + out.note : "Cancelled." }[action]);
            load();
          } catch (e) { toast(e.message, true); b.disabled = false; }
        });
        acts.append(b);
      };
      if (r.status === "pending") { btn("Approve and send payment link", "approve"); btn("Mark paid", "confirm", true, "Tap again to mark paid"); btn("Decline", "decline", true, "Tap again to decline"); }
      if (r.status === "expired") { btn("Approve again", "approve"); }
      if (r.status === "approved") { btn("Mark paid", "confirm", true, "Tap again to mark paid"); btn("Cancel", "cancel", true, "Tap again to cancel"); }
      if (r.status === "confirmed") { btn("Cancel booking", "cancel", true, "Tap again to cancel"); }
      if (acts.children.length) card.append(acts);
      list.append(card);
    }
  }

  // ---- calendar ----
  function renderCalendar() {
    const s = data.lastSync;
    const info = $("syncInfo"); info.innerHTML = "";
    if (!s) info.textContent = "Not synced yet. Add your Airbnb and VRBO calendar links, then sync.";
    else for (const [src, r] of Object.entries(s)) {
      const name = src === "airbnb" ? "Airbnb" : "VRBO";
      info.append(el("div", { textContent: r.skipped ? `${name}: no calendar link added yet.` : r.ok ? `${name}: ${r.events} reservations imported ${new Date(r.at).toLocaleString()}.` : `${name}: last sync failed (${r.error}). The previous import is still in use.` }));
    }
    const rows = [
      ...data.external.map((e) => ({ start: e.start_date, end: e.end_date, src: e.source === "airbnb" ? "Airbnb" : "VRBO" })),
      ...data.blocks.map((b) => ({ start: b.start_date, end: b.end_date, src: "Blocked" + (b.note ? `: ${b.note}` : ""), blockId: b.id })),
      ...data.requests.filter((r) => r.status === "confirmed" || r.status === "approved").map((r) => ({ start: r.check_in, end: r.check_out, src: `Direct: ${r.name}${r.status === "approved" ? " (awaiting payment)" : ""}` }))
    ].sort((a, b) => (a.start < b.start ? -1 : 1));
    const tb = $("upcoming").querySelector("tbody"); tb.innerHTML = "";
    if (!rows.length) tb.append(el("tr", {}, el("td", { colSpan: 4, className: "muted", textContent: "Nothing on the calendar yet." })));
    for (const r of rows) {
      const tr = el("tr", {}, el("td", { textContent: pretty(r.start) }), el("td", { textContent: pretty(r.end) }), el("td", { textContent: r.src }));
      const td = el("td");
      if (r.blockId) {
        const b = el("button", { className: "btn ghost", type: "button", textContent: "Remove" });
        b.addEventListener("click", async () => { try { await api(`/api/admin/blocks/${r.blockId}`, "DELETE"); toast("Block removed."); load(); } catch (e) { toast(e.message, true); } });
        td.append(b);
      }
      tr.append(td); tb.append(tr);
    }
  }
  $("syncBtn").addEventListener("click", async () => {
    $("syncBtn").disabled = true;
    try { await api("/api/admin/sync", "POST"); toast("Calendars synced."); load(); }
    catch (e) { toast(e.message, true); }
    finally { $("syncBtn").disabled = false; }
  });
  $("blockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/admin/blocks", "POST", { start: $("bStart").value, end: $("bEnd").value, note: $("bNote").value }); e.target.reset(); toast("Dates blocked."); load(); }
    catch (err) { toast(err.message, true); }
  });

  // ---- setup ----
  function renderSetup() {
    const s = data.setup;
    if (s.calendarExportUrl) $("exportUrl").textContent = s.calendarExportUrl;
    $("webhookUrl").textContent = s.webhookUrl;
    const items = [
      [s.airbnbFeed, "Airbnb calendar link added (AIRBNB_ICAL_URL)"],
      [s.vrboFeed, "VRBO calendar link added (VRBO_ICAL_URL)"],
      [!!s.calendarExportUrl, "Direct-booking calendar feed ready (ICAL_TOKEN)"],
      [s.stripe && !(s.environment === "staging" && !s.stripeTestMode), s.environment === "staging"
        ? (s.stripeTestMode ? "Stripe connected in test mode (right for the test site)" : s.stripe ? "This test site has a LIVE Stripe key. Replace it with your sk_test_ key so no real cards are charged" : "Stripe not connected (add your sk_test_ key)")
        : (s.stripeTestMode ? "Stripe connected in TEST mode: switch to your live key before taking real bookings" : "Stripe connected (STRIPE_SECRET_KEY)")],
      [s.stripeWebhook, "Stripe webhook secret added (STRIPE_WEBHOOK_SECRET)"],
      [s.email, "Email notifications on (RESEND_API_KEY, FROM_EMAIL, OWNER_EMAIL)"]
    ];
    const box = $("checklist"); box.innerHTML = "";
    for (const [ok, label] of items) box.append(el("div", { className: "check" }, el("b", { textContent: ok ? "✓" : "○", style: `color:var(${ok ? "--ok" : "--muted"})` }), el("span", { textContent: label })));
  }
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy($(b.dataset.copy).textContent)));
  function copy(text) { navigator.clipboard.writeText(text).then(() => toast("Copied."), () => toast("Select the text and copy it manually.", true)); }

  window.TS_ADMIN = { api, toast, money, pretty, el };
  load();
})();
