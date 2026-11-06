// The Teal Seashell — guest booking page
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (c) => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const pretty = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

  const state = { today: null, until: null, blocked: new Set(), rates: {}, view: null, checkIn: null, checkOut: null, quote: null, property: null };

  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
    return data;
  }
  function showMsg(el, text) { el.textContent = text || ""; el.hidden = !text; }

  // ---- property + rates ----
  function renderProperty({ property, pricing }) {
    state.property = property;
    $("ciTime").textContent = property.checkInTime;
    $("coTime").textContent = property.checkOutTime;
    $("maxGuests").textContent = `Up to ${property.maxGuests}`;
    const sel = $("guests");
    for (let i = 1; i <= property.maxGuests; i++) { const o = document.createElement("option"); o.value = i; o.textContent = i; sel.appendChild(o); }
    sel.value = Math.min(2, property.maxGuests);

    const MON = MONTHS.map((x) => x.slice(0, 3));
    const mdLabel = (mmdd, back) => {
      // "MM-DD" -> "Mar 1"; back=true shows the day before (end dates are exclusive)
      let [mm, dd] = mmdd.split("-").map(Number);
      if (mm === 13) { mm = 12; dd = 32; }
      const d = new Date(Date.UTC(2027, mm - 1, dd - (back ? 1 : 0)));
      return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
    };
    const cell = (tr, t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); };
    const body = $("ratesTable").querySelector("tbody");
    // Merge seasons that share a name and price (e.g. Winter at both ends of the year)
    const merged = [];
    for (const s of pricing.seasons) {
      const m = merged.find((x) => x.name === s.name && x.nightly === s.nightly);
      if (m) m.ranges.push(s); else merged.push({ ...s, ranges: [s] });
    }
    for (const s of merged) {
      const tr = document.createElement("tr");
      const ranges = s.ranges.length === 2 && s.ranges[0].start === "01-01" && s.ranges[1].end === "13-01"
        ? `${mdLabel(s.ranges[1].start)} – ${mdLabel(s.ranges[0].end, true)}`
        : s.ranges.map((r) => `${mdLabel(r.start)} – ${mdLabel(r.end, true)}`).join(", ");
      cell(tr, s.name); cell(tr, ranges); cell(tr, `${s.minNights} nights`); cell(tr, `$${Math.max(s.nightly, pricing.nightlyFloor)}`);
      body.appendChild(tr);
    }
    const tr = document.createElement("tr");
    cell(tr, "Snowbird monthly"); cell(tr, "Starting Nov – Feb"); cell(tr, `${pricing.monthly.minNights} nights`); cell(tr, `$${pricing.monthly.perMonth.toLocaleString()} / month`);
    body.appendChild(tr);
    const days = pricing.weekend.nights.map((n) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][n]).join(" and ");
    $("weekendNote").textContent = `${days} nights are ${pricing.weekend.percent}% higher outside holidays. Nightly rates never drop below $${pricing.nightlyFloor}.`;

    const hb = $("holidayTable").querySelector("tbody");
    const rangeLabel = (startIso, endIso) => {
      const a = new Date(startIso + "T00:00:00Z"), b = new Date(endIso + "T00:00:00Z"); b.setUTCDate(b.getUTCDate() - 1);
      const am = MON[a.getUTCMonth()], bm = MON[b.getUTCMonth()];
      if (am === bm && a.getUTCFullYear() === b.getUTCFullYear()) return a.getUTCDate() === b.getUTCDate() ? `${am} ${a.getUTCDate()}, ${a.getUTCFullYear()}` : `${am} ${a.getUTCDate()}–${b.getUTCDate()}, ${b.getUTCFullYear()}`;
      return `${am} ${a.getUTCDate()} – ${bm} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
    };
    for (const h of pricing.holidays) {
      const r = document.createElement("tr");
      cell(r, h.name); cell(r, rangeLabel(h.start, h.end)); cell(r, `${h.minNights} nights`); cell(r, `$${h.nightly}`);
      hb.appendChild(r);
    }
    $("ratesNote").textContent = `${pricing.weeklyDiscount.percent}% off stays of ${pricing.weeklyDiscount.minNights}+ nights. Plus a $${pricing.cleaningFee} cleaning fee and ${Math.round(pricing.taxRate * 100)}% Florida, Bay County and city lodging taxes, shown in your quote before you request.`;

    if (property.photos && property.photos.length) {
      const g = $("gallery");
      property.photos.slice(0, 5).forEach((p) => { const img = document.createElement("img"); img.src = p.src; img.alt = p.alt || ""; img.loading = "lazy"; g.appendChild(img); });
      g.hidden = false;
    }
    const links = [];
    if (property.airbnbUrl) links.push(`<a href="${encodeURI(property.airbnbUrl)}" target="_blank" rel="noopener">Airbnb</a>`);
    if (property.vrboUrl) links.push(`<a href="${encodeURI(property.vrboUrl)}" target="_blank" rel="noopener">VRBO</a>`);
    if (links.length) { $("also").innerHTML = `Also listed on ${links.join(" and ")}.`; $("also").hidden = false; }
    const contact = [property.contactEmail, property.contactPhone].filter(Boolean).join(" · ");
    $("contactLine").textContent = contact;
  }

  // ---- calendar ----
  function nightFree(d) { return !state.blocked.has(d); }
  function rangeFree(a, b) { for (let d = a; d < b; d = addDays(d, 1)) if (!nightFree(d)) return false; return true; }

  function renderCal() {
    const cal = $("cal");
    cal.innerHTML = "";
    const [y, m] = state.view;
    $("monthLabel").textContent = `${MONTHS[m]} ${y}`;
    const t = new Date(state.today + "T00:00:00Z");
    $("prevMonth").disabled = y === t.getUTCFullYear() && m === t.getUTCMonth();
    const u = new Date(state.until + "T00:00:00Z");
    $("nextMonth").disabled = y === u.getUTCFullYear() && m === u.getUTCMonth();

    ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((d) => { const el = document.createElement("div"); el.className = "dow"; el.textContent = d; cal.appendChild(el); });
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (let i = 0; i < first; i++) { const e = document.createElement("div"); e.className = "empty"; cal.appendChild(e); }
    for (let d = 1; d <= days; d++) {
      const date = iso(y, m, d);
      const past = date < state.today || date > state.until;
      const b = document.createElement("button");
      b.type = "button"; b.dataset.date = date;
      const num = document.createElement("span"); num.textContent = d; b.appendChild(num);
      if (!past && state.rates[date] && nightFree(date)) { const pr = document.createElement("small"); pr.textContent = "$" + state.rates[date]; b.appendChild(pr); }
      const booked = !nightFree(date);
      // A booked day can still be a check-out day if the nights before it are free
      const canCheckout = state.checkIn && !state.checkOut && date > state.checkIn && rangeFree(state.checkIn, date);
      if (past) b.disabled = true;
      else if (booked && !canCheckout) { b.disabled = true; b.classList.add("booked"); }
      else if (booked && canCheckout) b.classList.add("checkout-only");
      if (date === state.checkIn) b.classList.add("start");
      if (date === state.checkOut) b.classList.add("end");
      if (state.checkIn && state.checkOut && date > state.checkIn && date < state.checkOut) b.classList.add("in-range");
      b.setAttribute("aria-label", `${pretty(date)}${state.rates[date] && !booked ? ", $" + state.rates[date] : ""}${booked ? ", booked" : ""}${date === state.checkIn ? ", check-in" : ""}${date === state.checkOut ? ", check-out" : ""}`);
      cal.appendChild(b);
    }
    $("pickIn").textContent = state.checkIn ? pretty(state.checkIn) : "Add date";
    $("pickOut").textContent = state.checkOut ? pretty(state.checkOut) : "Add date";
  }

  function pick(date) {
    showMsg($("calMsg"), "");
    if (!state.checkIn || state.checkOut || date <= state.checkIn) {
      if (!nightFree(date)) return;
      state.checkIn = date; state.checkOut = null; state.quote = null;
      $("quote").hidden = true; $("reqForm").hidden = true;
    } else if (rangeFree(state.checkIn, date)) {
      state.checkOut = date;
      getQuote();
    } else {
      state.checkIn = nightFree(date) ? date : null; state.checkOut = null;
      showMsg($("calMsg"), "Some nights in that range are booked. Pick a new check-in date.");
    }
    renderCal();
  }

  async function getQuote() {
    const q = $("quote");
    q.hidden = false; q.innerHTML = `<p class="muted small">Pricing your stay…</p>`;
    try {
      const { quote } = await api("/api/quote", { checkIn: state.checkIn, checkOut: state.checkOut, guests: Number($("guests").value) });
      state.quote = quote;
      q.innerHTML = "";
      for (const l of quote.lines) {
        const r = document.createElement("div"); r.className = "row";
        const a = document.createElement("span"); a.textContent = l.label;
        const b = document.createElement("span"); b.textContent = money(l.cents);
        r.append(a, b); q.appendChild(r);
      }
      const tot = document.createElement("div"); tot.className = "row total";
      tot.innerHTML = `<span>Total for ${quote.nights} nights</span><span>${money(quote.totalCents)}</span>`;
      q.appendChild(tot);
      if (quote.savingsCents > 0) {
        const s = document.createElement("p"); s.className = "save";
        s.textContent = `About ${money(quote.savingsCents)} less than the same stay with Airbnb's guest service fee.`;
        q.appendChild(s);
      }
      $("reqForm").hidden = false;
    } catch (e) {
      q.hidden = true; $("reqForm").hidden = true;
      showMsg($("calMsg"), e.message);
    }
  }

  $("cal").addEventListener("click", (e) => { const b = e.target.closest("button[data-date]"); if (b && !b.disabled) pick(b.dataset.date); });
  $("prevMonth").addEventListener("click", () => { let [y, m] = state.view; m--; if (m < 0) { m = 11; y--; } state.view = [y, m]; renderCal(); });
  $("nextMonth").addEventListener("click", () => { let [y, m] = state.view; m++; if (m > 11) { m = 0; y++; } state.view = [y, m]; renderCal(); });
  $("guests").addEventListener("change", () => { if (state.checkIn && state.checkOut) getQuote(); });

  $("reqForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg($("calMsg"), "");
    const btn = $("sendBtn");
    btn.disabled = true; btn.textContent = "Sending request…";
    try {
      await api("/api/requests", {
        checkIn: state.checkIn, checkOut: state.checkOut, guests: Number($("guests").value),
        name: $("name").value, email: $("email").value, phone: $("phone").value, notes: $("notes").value, website: $("website").value
      });
      $("reqForm").hidden = true; $("quote").hidden = true;
      showMsg($("sentMsg"), `Request sent for ${pretty(state.checkIn)} to ${pretty(state.checkOut)}. You'll get an email when the owner approves it, with a secure link to pay.`);
    } catch (err) {
      showMsg($("calMsg"), err.message);
    } finally {
      btn.disabled = false; btn.textContent = "Request to book";
    }
  });

  function showTestBanner() {
    const b = document.createElement("div");
    b.className = "test-banner";
    b.textContent = "Test site. Bookings and payments here aren't real. Use Stripe test card 4242 4242 4242 4242.";
    document.body.prepend(b);
  }

  // ---- boot ----
  Promise.all([api("/api/property"), api("/api/availability")]).then(([prop, avail]) => {
    if (prop.environment === "staging") showTestBanner();
    renderProperty(prop);
    state.today = avail.today; state.until = avail.until; state.blocked = new Set(avail.blocked); state.rates = avail.rates || {};
    const t = new Date(avail.today + "T00:00:00Z");
    state.view = [t.getUTCFullYear(), t.getUTCMonth()];
    renderCal();
  }).catch(() => {
    showMsg($("calMsg"), "The calendar couldn't load. Refresh the page, or email us to check dates.");
  });
})();
