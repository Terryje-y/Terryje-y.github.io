// Tiny, dependency-free site script: menu, cookie notice, copy link, search.
(() => {
  const btn = document.querySelector(".menu-btn"), nav = document.getElementById("nav");
  if (btn && nav) {
    btn.addEventListener("click", () => { const o = nav.classList.toggle("open"); btn.setAttribute("aria-expanded", o); });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => { nav.classList.remove("open"); btn.setAttribute("aria-expanded", false); }));
  }

  const bar = document.getElementById("progress");
  if (bar) {
    const upd = () => { const h = document.documentElement; const max = h.scrollHeight - h.clientHeight; bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + "%"; };
    addEventListener("scroll", upd, {passive: true}); upd();
  }

  const cookie = document.getElementById("cookie");
  let seen = false;
  try { seen = localStorage.getItem("cookie_ok") === "1"; } catch (e) { /* storage blocked */ }
  if (cookie && !seen) {
    cookie.hidden = false;
    document.getElementById("cookie-ok").addEventListener("click", () => {
      try { localStorage.setItem("cookie_ok", "1"); } catch (e) { /* ignore */ }
      cookie.hidden = true;
    });
  }

  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Link copied"; }
    catch (e) { prompt("Copy this link:", b.dataset.copy); }
  }));

  const q = document.getElementById("q"), out = document.getElementById("results");
  if (q && out) {
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
    let index = [];
    fetch("/search-index.json").then((r) => r.json()).then((d) => { index = d; run(); });
    const params = new URLSearchParams(location.search);
    if (params.get("q")) q.value = params.get("q");
    function run() {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) { out.innerHTML = ""; return; }
      const hits = index.map((a) => {
        const hay = (a.t + " " + a.d + " " + a.c + " " + a.k).toLowerCase();
        const score = terms.reduce((s, t) => s + (hay.includes(t) ? (a.t.toLowerCase().includes(t) ? 3 : 1) : -100), 0);
        return {a, score};
      }).filter((h) => h.score > 0).sort((x, y) => y.score - x.score);
      out.innerHTML = hits.length ? hits.map(({a}) => `<a href="${a.u}"><b>${esc(a.t)}</b><span>${esc(a.c)} · ${esc(a.d)}</span></a>`).join("")
        : "<p>No articles match yet. Try a broader word such as <em>FFmpeg</em> or <em>captions</em>.</p>";
    }
    q.addEventListener("input", run);
  }
})();
