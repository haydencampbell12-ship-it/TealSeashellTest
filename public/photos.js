// The Teal Seashell — Photos page: grid of every photo in src/config.js, with a full-size viewer.
(() => {
  const $ = (id) => document.getElementById(id);
  const grid = $("grid"), lb = $("lb");
  let photos = [], current = 0;

  function show(i) {
    current = (i + photos.length) % photos.length;
    const p = photos[current];
    $("lbImg").src = p.src; $("lbImg").alt = p.alt || "";
    $("lbCap").textContent = p.alt || "";
    $("lbCount").textContent = `${current + 1} of ${photos.length}`;
    history.replaceState(null, "", `#${current + 1}`);
    new Image().src = photos[(current + 1) % photos.length].src; // preload the next one
  }
  function open(i) {
    show(i);
    if (typeof lb.showModal === "function") lb.showModal(); else window.open(photos[i].src, "_blank");
  }
  function close() { lb.close(); }
  lb.addEventListener("close", () => { history.replaceState(null, "", location.pathname); grid.querySelectorAll("button")[current]?.focus(); });

  $("lbClose").addEventListener("click", close);
  $("lbPrev").addEventListener("click", () => show(current - 1));
  $("lbNext").addEventListener("click", () => show(current + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb || e.target.tagName === "FIGURE") close(); });
  lb.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); show(current - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(current + 1); }
  });
  // Swipe left/right on phones
  let x0 = null;
  lb.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
  });

  fetch("/api/property").then((r) => r.json()).then(({ property }) => {
    photos = property.photos || [];
    grid.innerHTML = "";
    if (!photos.length) { grid.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Photos are coming soon." })); return; }
    photos.forEach((p, i) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", `Open photo ${i + 1}: ${p.alt || ""}`);
      const img = document.createElement("img"); img.src = p.thumb || p.src; img.alt = p.alt || ""; img.loading = i < 4 ? "eager" : "lazy"; img.width = 800; img.height = 600;
      const cap = document.createElement("span"); cap.textContent = p.alt || "";
      b.append(img, cap); b.addEventListener("click", () => open(i));
      grid.append(b);
    });
    const n = parseInt(location.hash.slice(1), 10);
    if (n >= 1 && n <= photos.length) open(n - 1);
  }).catch(() => { grid.innerHTML = '<p class="muted">The photos couldn\'t load. Refresh the page to try again.</p>'; });
})();
