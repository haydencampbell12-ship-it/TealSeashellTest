// The Teal Seashell — Finances tab: owner payouts, expenses and net, by month and by stay.
// Money follows your management statements: host payout − cleaning − taxes − management fee = owner payout,
// counted in the month it pays out (the day after check-in).
(() => {
  const A = window.TS_ADMIN;
  if (!A) return;
  const { api, toast, el } = A;
  const panel = document.getElementById("finPanel");
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const CH = { managed: "Managed (past)", direct: "Direct", airbnb: "Airbnb", vrbo: "VRBO", other: "Other" };
  const ORDER = ["managed", "direct", "airbnb", "vrbo"];
  const usd = (c) => (c < 0 ? "−$" : "$") + Math.round(Math.abs(c) / 100).toLocaleString("en-US");
  const usd2 = (c) => (c < 0 ? "−$" : "$") + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthLabel = (ym, long) => { const [y, m] = ym.split("-").map(Number); return long ? `${MON[m - 1]} ${y}` : `${MON[m - 1]} ’${String(y).slice(2)}`; };
  const shortDate = (s) => { const d = new Date(s + "T00:00:00Z"); return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`; };
  const field = (label, input) => el("div", { className: "field" }, el("label", { htmlFor: input.id, textContent: label }), input);
  let data = null;
  let stayView = "upcoming";
  let view = "projected"; // "projected" = booked + filled to the occupancy target; "booked" = real bookings only
  const mv = (m) => (view === "projected" && m.withProjection ? { ...m, ...m.withProjection } : m);
  const tv = () => (view === "projected" ? { ...data.totals, ...data.totals.withProjection } : data.totals);
  let openEditor = null;

  async function load() {
    try { data = await api("/api/admin/finance"); render(); }
    catch (e) { panel.innerHTML = ""; panel.append(el("div", { className: "card" }, el("p", { className: "msg error", textContent: e.message }))); }
  }
  window.TS_FINANCE = { load };

  function render() {
    panel.innerHTML = "";
    panel.append(el("div", { className: "fin" }, viewSwitch(), summary(), chart(), monthTable(), stayTable(), addStayCard(), expensesCard(), settingsCard()));
  }

  function viewSwitch() {
    const s = data.settings;
    const seg = el("div", { className: "seg", role: "group", "aria-label": "Forecast view" });
    for (const [k, label] of [["projected", `Booked + projected to ${s.occupancyTarget}%`], ["booked", "Booked only"]]) {
      const b = el("button", { className: "tab", type: "button", textContent: label });
      b.setAttribute("aria-selected", String(view === k));
      b.addEventListener("click", () => { view = k; render(); });
      seg.append(b);
    }
    const note = el("p", { className: "muted small", textContent: view === "projected"
      ? `Future months are filled to ${s.occupancyTarget}% occupancy at your rate-card prices (as Airbnb stays, after the ${s.airbnbFeePct}% host fee, $${(s.cleaningCostCents / 100).toFixed(0)} cleaning and ${s.localTaxPct}% taxes). Projected nights are shown separately from real bookings.`
      : "Only stays that are actually booked or already paid." });
    return el("div", { style: "display:grid;gap:8px" }, seg, note);
  }

  // ---- Summary ----
  function summary() {
    const t = tv(), h = data.history, s = data.settings;
    const box = el("div", { style: "display:grid;gap:12px" });
    const tile = (label, value, note, cls) => el("div", { className: "tile " + (cls || "") }, el("span", { textContent: label }), el("b", { textContent: value }), el("small", { textContent: note }));
    box.append(el("p", { className: "section-label", textContent: view === "projected" ? `Next 12 months at ${s.occupancyTarget}% occupancy` : "Next 12 months, booked so far" }));
    box.append(el("div", { className: "tiles" },
      tile("Owner payout", usd(t.ownerCents), "Host payouts after cleaning and taxes"),
      tile("Expenses", usd(t.expenseCents), "Carrying costs and other expenses you've added"),
      tile("Projected net", usd(t.netCents), "Owner payout minus expenses", t.netCents < 0 ? "neg" : "pos"),
      tile("Occupancy", `${t.occupancy}%`, view === "projected" ? `${t.bookedNights - t.projectedNights} booked + ${t.projectedNights} projected of ${t.days} nights` : `${t.bookedNights} of ${t.days} nights booked · target ${s.occupancyTarget}%`)
    ));
    const card = el("div", { className: "card" });
    if (h.stays) {
      card.append(el("h3", { textContent: `${monthLabel(data.months[0].month, true)} – ${monthLabel(data.months.filter((m) => m.past).slice(-1)[0].month, true)}, actual`, style: "font-size:18px" }));
      const flow = el("div", { className: "flow" });
      const step = (label, c, op) => { if (op) flow.append(el("span", { className: "op", textContent: op })); flow.append(el("span", {}, `${label} `, el("b", { textContent: usd2(c) }))); };
      step("Host payouts", h.hostCents); step("cleaning", h.cleaningCents, "−"); step("taxes", h.taxesCents, "−"); step("management", h.mgmtCents, "−");
      step("owner payout", h.ownerCents, "="); step("expenses", h.expenseCents, "−"); step("net", h.netCents, "=");
      card.append(flow);
      card.append(el("p", { className: "insight muted", textContent: `${h.stays} stays, ${h.bookedNights} nights booked (${h.occupancy}% occupancy). You kept ${Math.round(h.ownerCents / h.hostCents * 100)}% of every payout dollar, about ${usd2(Math.round(h.ownerCents / h.bookedNights))} per booked night.` }));
    }
    const lines = [];
    if (view === "booked") lines.push(`At your ${s.occupancyTarget}% target the next 12 months would bring about ${usd(data.totals.withProjection.ownerCents)} in owner payouts and ${usd(data.totals.withProjection.netCents)} net. Switch to the projected view to see it month by month.`);
    else lines.push(`${usd(t.projectedOwnerCents)} of the owner payout comes from ${t.projectedNights} projected nights that aren't booked yet.`);
    if (t.mgmtSavedPerMonthCents) lines.push(`Managing the studio yourself since ${new Date(s.selfManagedFrom + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })} keeps the ${s.managementFeePct}% management fee, about ${usd(t.mgmtSavedPerMonthCents)} a month based on July–October. Direct bookings from this website also skip Airbnb and VRBO fees.`);
    const pend = data.pipeline.pending, appr = data.pipeline.approved;
    if (pend.count || appr.count) lines.push(`Not counted yet: ${pend.count} website request${pend.count === 1 ? "" : "s"} waiting for review and ${appr.count} awaiting payment (${usd(pend.totalCents + appr.totalCents)} with taxes).`);
    const est = data.stays.filter((b) => b.isBooking && b.estimated && b.checkOut > data.today).length;
    if (est) lines.push(`${est} upcoming Airbnb/VRBO stay${est === 1 ? " is" : "s are"} estimated from your rate card. Choose Edit to enter the real host payout once Airbnb or VRBO pays you.`);
    lines.forEach((l) => card.append(el("p", { className: "insight", textContent: l })));
    box.append(card);
    return box;
  }

  // ---- Chart: owner payout by channel (stacked), dashed line for expenses ----
  function chart() {
    const card = el("div", { className: "card chart-card" });
    card.append(el("h3", { textContent: "Owner payout and expenses by month" }));
    const used = ORDER.filter((k) => data.months.some((m) => m.hostCents[k] > 0));
    const legend = el("div", { className: "legend-row" });
    for (const k of used) legend.append(el("span", {}, el("i", { style: `background:var(--c-${k})` }), CH[k]));
    if (view === "projected") legend.append(el("span", {}, el("i", { className: "proj-swatch" }), `Projected to ${data.settings.occupancyTarget}%`));
    legend.append(el("span", {}, el("i", { className: "line" }), "Expenses"));
    card.append(legend);

    const months = data.months;
    const W = 880, H = 300, L = 56, R = 12, T = 12, B = 36, pw = W - L - R, ph = H - T - B;
    const share = (m) => { const g = m.hostTotalCents || 1; return Object.fromEntries(ORDER.map((k) => [k, Math.max(0, m.ownerCents) * (m.hostCents[k] / g)])); };
    const projOwner = (m) => (view === "projected" && m.projected ? Math.max(0, m.projected.ownerCents) : 0);
    const maxV = Math.max(1, ...months.map((m) => m.ownerCents + projOwner(m)), ...months.map((m) => m.expenseCents));
    const step = niceStep(maxV / 4), top = Math.ceil(maxV / step) * step;
    const y = (v) => T + ph - (v / top) * ph;
    const bw = pw / months.length, barW = Math.min(36, bw * 0.62);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Owner payout by month compared with expenses. The table below has the same numbers.");
    const add = (tag, attrs, text, parent) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; (parent || svg).appendChild(n); return n; };
    const hitLayer = add("g", {});
    const defs = add("defs", {});
    const pat = add("pattern", { id: "projHatch", width: "6", height: "6", patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, null, defs);
    add("rect", { width: "6", height: "6", class: "proj-bg" }, null, pat);
    add("line", { x1: "0", y1: "0", x2: "0", y2: "6", class: "proj-line" }, null, pat);
    for (let v = 0; v <= top + 1; v += step) { add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" }); add("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, usd(v)); }
    months.forEach((m, i) => {
      const cx = L + bw * i + bw / 2, parts = share(m);
      const pv = projOwner(m);
      const segs = [...ORDER.filter((k) => parts[k] > 0), ...(pv > 0 ? ["projected"] : [])];
      let base = 0;
      segs.forEach((k, j) => {
        const v = k === "projected" ? pv : parts[k];
        const y1 = y(base + v), y0 = y(base), h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
        add("path", { d: roundedTop(cx - barW / 2, y1, barW, h, j === segs.length - 1 ? Math.min(4, h / 2, barW / 2) : 0), fill: k === "projected" ? "url(#projHatch)" : `var(--c-${k})`, class: k === "projected" ? "proj-bar" : "" });
        base += v;
      });
      add("text", { x: cx, y: H - 14, "text-anchor": "middle", class: m.current ? "now" : "" }, monthLabel(m.month));
    });
    add("polyline", { points: months.map((m, i) => `${L + bw * i + bw / 2},${y(m.expenseCents)}`).join(" "), class: "cost" });
    const wrapEl = el("div", { className: "chart-wrap" });
    const tip = el("div", { className: "tip", hidden: true });
    months.forEach((m, i) => {
      const V = mv(m);
      const hit = add("rect", { x: L + bw * i, y: T, width: bw, height: ph, class: "hit", tabindex: "0", "aria-label": `${monthLabel(m.month, true)}: owner payout ${usd(V.ownerCents)}, expenses ${usd(m.expenseCents)}, net ${usd(V.netCents)}` }, null, hitLayer);
      const show = () => {
        svg.querySelectorAll(".hit").forEach((x) => x.classList.remove("on")); hit.classList.add("on");
        tip.innerHTML = "";
        tip.append(el("b", { textContent: `${monthLabel(m.month, true)} · ${V.occupancy}% ${view === "projected" && m.projected.nights ? "incl. projected" : "booked"}` }));
        const row = (label, c, sw) => tip.append(el("div", {}, el("span", {}, ...(sw ? [el("i", { style: `background:var(--c-${sw})` })] : []), label), el("span", { textContent: usd(c) })));
        for (const k of ORDER) if (m.hostCents[k]) row(`${CH[k]} payouts`, m.hostCents[k], k);
        if (view === "projected" && m.projected.nights) row(`Projected (${m.projected.nights} nts at ~$${m.projected.avgRate})`, m.projected.hostCents);
        if (V.hostTotalCents) { row("Cleaning, taxes, mgmt", -(V.cleaningCents + V.taxesCents + V.mgmtCents)); row("Owner payout", V.ownerCents); }
        row("Expenses", -m.expenseCents);
        tip.append(el("div", { style: "font-weight:700;border-top:1px solid var(--line);padding-top:4px;margin-top:2px" }, el("span", { textContent: "Net" }), el("span", { textContent: usd(V.netCents) })));
        tip.hidden = false;
        const box = wrapEl.getBoundingClientRect(), r = hit.getBoundingClientRect();
        tip.style.left = Math.min(box.width - 220, Math.max(0, r.left - box.left + r.width / 2 - 110) + wrapEl.scrollLeft) + "px"; tip.style.top = "8px";
      };
      const hide = () => { tip.hidden = true; hit.classList.remove("on"); };
      hit.addEventListener("mouseenter", show); hit.addEventListener("focus", show); hit.addEventListener("mouseleave", hide); hit.addEventListener("blur", hide);
    });
    wrapEl.append(svg, tip); card.append(wrapEl);
    return card;
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function roundedTop(x, y, w, h, r) { return h <= 0 ? "" : `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }

  // ---- Month by month, laid out like your old statements ----
  function monthTable() {
    const card = el("div", { className: "card" });
    card.append(el("h3", { textContent: "Month by month" }));
    const tw = el("div", { className: "table-wrap" });
    const t = el("table", { className: "fin-table" });
    t.append(el("thead", {}, el("tr", {}, ...["Month", "Booked", "Host payout", "Cleaning", "Taxes", "Management", "Owner payout", "Expenses", "Net"].map((h) => el("th", { textContent: h })))));
    const tb = el("tbody");
    const row = (label, m, cls) => {
      const tr = el("tr", { className: cls || "" });
      const proj = m.projected && view === "projected" ? m.projected.nights : (m.projectedNights && view === "projected" ? m.projectedNights : 0);
      [label, proj ? `${m.bookedNights - proj} + ${proj} proj. · ${m.occupancy}%` : `${m.bookedNights} nts · ${m.occupancy}%`, usd2(m.hostTotalCents ?? m.hostCents), usd2(-m.cleaningCents), usd2(-m.taxesCents), usd2(-m.mgmtCents), usd2(m.ownerCents), usd2(-m.expenseCents), usd2(m.netCents)]
        .forEach((v, i) => tr.append(el("td", { textContent: v, className: i === 8 && m.netCents < 0 ? "neg" : "" })));
      tb.append(tr);
    };
    for (const m of data.months) row(monthLabel(m.month, true) + (m.current ? " (now)" : m.past ? " · actual" : (view === "projected" && m.projected.nights) ? " · proj." : m.estimatedStays ? " · est." : ""), mv(m), m.past ? "past" : "");
    if (data.history.stays) row("Past months, actual", data.history, "total");
    row(view === "projected" ? `Next 12 months at ${data.settings.occupancyTarget}%` : "Next 12 months, booked", tv(), "total");
    t.append(tb); tw.append(t); card.append(tw);
    card.append(el("p", { className: "muted small", textContent: `Each stay is counted in the month it pays out, the day after check-in, the same way your management statements group them. Booked nights are counted in the month they fall in. Future Airbnb and VRBO stays use your rate card minus platform fees, ${data.settings.localTaxPct}% taxes and $${(data.settings.cleaningCostCents / 100).toFixed(0)} cleaning. The management fee only appears on stays from before you took over.` }));
    return card;
  }

  // ---- Stays by guest ----
  function stayTable() {
    const card = el("div", { className: "card" });
    const top = el("div", { className: "req-top" }, el("h3", { textContent: "Stays by guest" }));
    const seg = el("div", { className: "seg" });
    for (const [k, label] of [["upcoming", "Upcoming"], ["past", "Past"], ["blocked", "Blocked dates"]]) {
      const b = el("button", { className: "tab", type: "button", textContent: label });
      b.setAttribute("aria-selected", String(stayView === k));
      b.addEventListener("click", () => { stayView = k; openEditor = null; render(); });
      seg.append(b);
    }
    top.append(seg); card.append(top);
    const list = data.stays.filter((b) => stayView === "blocked" ? !b.isBooking : b.isBooking && (stayView === "past" ? b.checkOut <= data.today : b.checkOut > data.today));
    if (stayView === "past") list.reverse();
    if (!list.length) {
      card.append(el("p", { className: "muted", textContent: { upcoming: "No upcoming stays yet. Bookings from this website, Airbnb and VRBO show up here after the next calendar sync.", past: "No past stays in this range.", blocked: "No blocked dates in this range." }[stayView] }));
      return card;
    }
    if (stayView === "blocked") card.append(el("p", { className: "muted small", textContent: "Dates a calendar marks unavailable, usually a stay booked on the other platform or one of your own blocks. They aren't counted as revenue. If one is really a guest stay, choose Edit and count it as a stay." }));
    const tw = el("div", { className: "table-wrap" });
    const t = el("table", { className: "fin-table" });
    t.append(el("thead", {}, el("tr", {}, ...["Dates", "Channel", "Guest", "Nights", "Host payout", "Cleaning", "Taxes", "Mgmt", "Owner payout", ""].map((h, i) => el("th", { textContent: h, className: i < 3 ? "left" : "" })))));
    const tb = el("tbody");
    for (const b of list) {
      const tr = el("tr", { className: b.isBooking ? "" : "past" });
      tr.append(el("td", { className: "left", textContent: `${shortDate(b.checkIn)} – ${shortDate(b.checkOut)}` }));
      tr.append(el("td", { className: "left" }, el("span", { className: "chan" }, el("i", { style: `background:var(--c-${b.channel === "other" ? "managed" : b.channel})` }), CH[b.channel])));
      tr.append(el("td", { className: "left", textContent: (b.guest || (b.isBooking ? "Add name" : "Blocked, not a stay")) + (b.channel === "direct" && b.guests ? ` (${b.guests})` : "") }));
      tr.append(el("td", { textContent: String(b.nights) }));
      const cells = b.isBooking ? [b.hostPayoutCents, -b.cleaningCents, -b.taxesCents, -b.mgmtCents] : [null, null, null, null];
      cells.forEach((c) => tr.append(el("td", { textContent: c === null ? "—" : usd2(c) })));
      const own = el("td"); if (b.isBooking) { own.append(usd2(b.ownerCents)); own.append(el("div", { className: "est", textContent: b.basis })); } else own.textContent = "—";
      tr.append(own);
      const act = el("td");
      if (b.manual) {
        const del = el("button", { className: "btn ghost", type: "button", textContent: "Remove" });
        del.addEventListener("click", async () => {
          if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "Remove"; }, 4000); return; }
          try { await api(`/api/admin/finance/stays/${b.id}`, "DELETE"); toast("Stay removed."); load(); } catch (e) { toast(e.message, true); }
        });
        act.append(del);
      } else if (b.channel !== "direct") {
        const eb = el("button", { className: "btn ghost", type: "button", textContent: "Edit" });
        eb.addEventListener("click", () => { openEditor = openEditor === b.key ? null : b.key; render(); });
        act.append(eb);
      }
      tr.append(act); tb.append(tr);
      if (openEditor === b.key) tb.append(editorRow(b));
    }
    t.append(tb); tw.append(t); card.append(tw);
    return card;
  }

  function editorRow(b) {
    const tr = el("tr", { className: "edit-row" });
    const td = el("td", { colSpan: 10 });
    const f = el("form", { className: "edit-grid" });
    const guest = el("input", { id: "ed-guest", value: b.guest || "", placeholder: "e.g. Jordan K." });
    const payout = el("input", { id: "ed-payout", type: "number", step: "0.01", min: "0", value: b.estimated ? "" : (b.hostPayoutCents / 100).toFixed(2), placeholder: `Estimate ${usd2(b.hostPayoutCents)}` });
    const kind = el("select", { id: "ed-kind" });
    [["auto", `Decide from calendar ("${b.calendarLabel || "no label"}")`], ["yes", "A guest stay"], ["no", "Just blocked"]].forEach(([v, l]) => kind.append(el("option", { value: v, textContent: l })));
    const note = el("input", { id: "ed-note", value: b.note || "", placeholder: "Optional" });
    const save = el("button", { className: "btn", type: "submit", textContent: "Save", style: "width:auto" });
    f.append(field("Guest name", guest), field("Host payout ($)", payout), field("Count this as", kind), field("Note", note), el("div", {}, save));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); save.disabled = true;
      try {
        await api("/api/admin/finance/booking", "POST", { source: b.channel, uid: b.uid, guest: guest.value, payout: payout.value === "" ? null : payout.value, note: note.value, isBooking: kind.value === "auto" ? null : kind.value === "yes" });
        toast("Saved."); openEditor = null; load();
      } catch (err) { toast(err.message, true); save.disabled = false; }
    });
    td.append(f, el("p", { className: "muted small", style: "margin-top:8px", textContent: "Use the payout amount from your Airbnb or VRBO app. Cleaning and taxes are worked out from it." }));
    tr.append(td);
    return tr;
  }

  // ---- Add stays from a statement ----
  function addStayCard() {
    const card = el("details", { className: "card" });
    card.append(el("summary", { style: "cursor:pointer;font-weight:600", textContent: "Add a past stay or payout by hand" }));
    const f = el("form", { className: "inline-form", style: "margin-top:12px" });
    const guest = el("input", { id: "ms-guest", placeholder: "Guest name", required: true });
    const ci = el("input", { id: "ms-in", type: "date", required: true });
    const co = el("input", { id: "ms-out", type: "date", required: true });
    const host = el("input", { id: "ms-host", type: "number", step: "0.01", min: "0", placeholder: "0.00", required: true });
    const clean = el("input", { id: "ms-clean", type: "number", step: "0.01", min: "0", value: (data.settings.cleaningCostCents / 100).toFixed(2) });
    const tax = el("input", { id: "ms-tax", type: "number", step: "0.01", min: "0", placeholder: "0.00" });
    const stmt = el("input", { id: "ms-stmt", placeholder: "e.g. Airbnb payout, Nov 2026" });
    const btn = el("button", { className: "btn", type: "submit", textContent: "Add stay" });
    f.append(field("Guest", guest), field("Check-in", ci), field("Check-out", co), field("Host payout ($)", host), field("Cleaning fee ($)", clean), field("City & county taxes ($)", tax), field("Source", stmt), el("div", {}, btn));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        await api("/api/admin/finance/stays", "POST", { guest: guest.value, checkIn: ci.value, checkOut: co.value, hostPayout: host.value, cleaning: clean.value || 0, taxes: tax.value || 0, statement: stmt.value, channel: "managed" });
        toast("Stay added."); load();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
    card.append(f, el("p", { className: "muted small", style: "margin-top:8px", textContent: "Use this for stays from your old statements, or to record an Airbnb or VRBO payout exactly. A stay entered here replaces the estimate for any booking on the same dates." }));
    return card;
  }

  // ---- Expenses ----
  function expensesCard() {
    const card = el("div", { className: "card" });
    card.append(el("h3", { textContent: "Expenses" }));
    const tw = el("div", { className: "table-wrap" });
    const t = el("table", { className: "fin-table" });
    t.append(el("thead", {}, el("tr", {}, ...["Expense", "Repeats", "From", "Until", "Amount", ""].map((h, i) => el("th", { textContent: h, className: i < 4 ? "left" : "" })))));
    const tb = el("tbody");
    if (!data.expenses.length) tb.append(el("tr", {}, el("td", { colSpan: 6, className: "left muted", textContent: "No expenses yet. Add your mortgage, HOA dues, utilities and insurance below." })));
    for (const x of data.expenses) {
      const tr = el("tr");
      tr.append(el("td", { className: "left", textContent: x.name }), el("td", { className: "left", textContent: x.kind === "once" ? "One time" : "Monthly" }),
        el("td", { className: "left", textContent: monthLabel(x.start_month, true) }), el("td", { className: "left", textContent: x.kind === "once" ? "—" : x.end_month ? monthLabel(x.end_month, true) : "Ongoing" }),
        el("td", { textContent: usd2(x.amount_cents) }));
      const del = el("button", { className: "btn ghost", type: "button", textContent: "Remove" });
      del.addEventListener("click", async () => {
        if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Tap again"; setTimeout(() => { del.dataset.armed = ""; del.textContent = "Remove"; }, 4000); return; }
        try { await api(`/api/admin/expenses/${x.id}`, "DELETE"); toast("Expense removed."); load(); } catch (e) { toast(e.message, true); }
      });
      tr.append(el("td", {}, del)); tb.append(tr);
    }
    t.append(tb); tw.append(t); card.append(tw);
    const f = el("form", { className: "inline-form" });
    const name = el("input", { id: "exName", placeholder: "e.g. HOA dues", required: true });
    const amount = el("input", { id: "exAmt", type: "number", step: "0.01", min: "0", placeholder: "0.00", required: true });
    const kind = el("select", { id: "exKind" }); [["monthly", "Every month"], ["once", "One time"]].forEach(([v, l]) => kind.append(el("option", { value: v, textContent: l })));
    const start = el("input", { id: "exStart", type: "month", value: data.today.slice(0, 7), required: true });
    const end = el("input", { id: "exEnd", type: "month" });
    const endField = field("Until (optional)", end);
    kind.addEventListener("change", () => { endField.hidden = kind.value === "once"; });
    const btn = el("button", { className: "btn", type: "submit", textContent: "Add expense" });
    f.append(field("Expense", name), field("Amount ($)", amount), field("Repeats", kind), field("Starting", start), endField, el("div", {}, btn));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.disabled = true;
      try { await api("/api/admin/expenses", "POST", { name: name.value, amount: amount.value, kind: kind.value, startMonth: start.value, endMonth: kind.value === "once" ? null : end.value || null }); toast("Expense added."); load(); }
      catch (err) { toast(err.message, true); btn.disabled = false; }
    });
    card.append(el("h3", { textContent: "Add an expense", style: "font-size:17px;margin-top:6px" }), f);
    return card;
  }

  // ---- Settings ----
  function settingsCard() {
    const s = data.settings;
    const card = el("details", { className: "card" });
    card.append(el("summary", { style: "cursor:pointer;font-weight:600", textContent: "Forecast settings" }));
    const f = el("form", { className: "inline-form", style: "margin-top:10px" });
    const n = (id, v, step) => el("input", { id, type: "number", step: step || "0.01", min: "0", value: v });
    const i = {
      mgmt: n("sMgmt", s.managementFeePct), tax: n("sTax", s.localTaxPct), clean: n("sClean", (s.cleaningCostCents / 100).toFixed(2)),
      air: n("sAir", s.airbnbFeePct), vrbo: n("sVrbo", s.vrboFeePct), stripe: n("sStripe", s.stripePct),
      occ: n("sOcc", s.occupancyTarget, "1"), ahead: n("sAhead", s.monthsAhead, "1"), back: n("sBack", s.monthsBack, "1")
    };
    const selfFrom = el("input", { id: "sSelf", type: "date", value: s.selfManagedFrom });
    f.append(field("Self-managing since", selfFrom), field("Former management fee (%)", i.mgmt), field("City & county taxes (% of host payout)", i.tax), field("Cleaning per stay ($)", i.clean),
      field("Airbnb host fee (%)", i.air), field("VRBO commission (%)", i.vrbo), field("Stripe card fee (%)", i.stripe),
      field("Occupancy target (%)", i.occ), field("Months ahead", i.ahead), field("Months of history", i.back));
    const btn = el("button", { className: "btn", type: "submit", textContent: "Save settings" });
    f.append(el("div", {}, btn));
    f.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.disabled = true;
      try {
        await api("/api/admin/finance/settings", "POST", {
          managementFeePct: i.mgmt.value, localTaxPct: i.tax.value, cleaningCostCents: Math.round(Number(i.clean.value) * 100),
          airbnbFeePct: i.air.value, vrboFeePct: i.vrbo.value, stripePct: i.stripe.value, selfManagedFrom: selfFrom.value,
          occupancyTarget: i.occ.value, monthsAhead: i.ahead.value, monthsBack: i.back.value
        });
        toast("Settings saved."); load();
      } catch (err) { toast(err.message, true); btn.disabled = false; }
    });
    card.append(f, el("p", { className: "muted small", style: "margin-top:8px", textContent: "The $125 cleaning and 6.69% tax rate come from your July–October statements. Change them once you have your own cleaner and know the taxes you'll file. The management fee only applies to stays before your self-managing date." }));
    return card;
  }
})();
