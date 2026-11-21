// AI Video Studio: runs entirely in the visitor's browser with their own Gemini API key.
// The key is only ever sent to Google's Gemini API (generativelanguage.googleapis.com).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = "https://generativelanguage.googleapis.com/v1beta/models/";
  const DEFAULT_TEXT = "gemini-3.5-flash, gemini-3.8-flash, gemma-4-31b-it";
  const DEFAULT_TTS = "gemini-3.8-flash-tts, gemini-2.5-flash-preview-tts";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };
  let apiKey = store.get("nae_key") || "";
  let audio = null;            // {blob, buffer, url}
  let lastVideoUrl = "";
  let pack = null;             // AI output
  const media = [];            // {kind, el}

  // ---------- key ----------
  const keyStatus = (msg, ok) => { $("keyStatus").textContent = msg; $("keyStatus").className = "st-status " + (ok ? "ok" : "bad"); };
  if (apiKey) { $("apiKey").value = apiKey; keyStatus("Key saved on this device.", true); }
  $("saveKey").addEventListener("click", () => {
    apiKey = $("apiKey").value.trim();
    if (!apiKey) { store.del("nae_key"); keyStatus("Key removed.", true); return; }
    if ($("rememberKey").checked) store.set("nae_key", apiKey); else store.del("nae_key");
    keyStatus($("rememberKey").checked ? "Key saved on this device only." : "Key will be used for this visit only.", true);
  });
  $("apiKey").addEventListener("change", () => { apiKey = $("apiKey").value.trim(); });

  // ---------- models ----------
  $("textModels").value = store.get("nae_text") || DEFAULT_TEXT;
  $("ttsModels").value = store.get("nae_tts") || DEFAULT_TTS;
  $("textModels").addEventListener("change", () => store.set("nae_text", $("textModels").value));
  $("ttsModels").addEventListener("change", () => store.set("nae_tts", $("ttsModels").value));
  $("resetModels").addEventListener("click", () => { $("textModels").value = DEFAULT_TEXT; $("ttsModels").value = DEFAULT_TTS; store.del("nae_text"); store.del("nae_tts"); });
  const models = (id) => $(id).value.split(",").map((s) => s.trim()).filter(Boolean);

  class Fatal extends Error {}
  async function gemini(modelList, body, timeoutMs) {
    if (!apiKey) throw new Fatal("Paste your Gemini API key at the top first, then press Save.");
    const errors = [];
    for (const model of modelList) {
      let res, data;
      try {
        res = await fetch(API + encodeURIComponent(model) + ":generateContent", {
          method: "POST", signal: AbortSignal.timeout(timeoutMs),
          headers: {"content-type": "application/json", "x-goog-api-key": apiKey}, body: JSON.stringify(body)});
        data = await res.json().catch(() => ({}));
      } catch (e) {
        errors.push(`${model}: ${e.name === "TimeoutError" ? "took too long" : "network error"}`); continue;
      }
      if (res.ok) return {model, data};
      const msg = (data.error && data.error.message) || res.statusText;
      if (res.status === 400 && /api key/i.test(msg) || res.status === 401 || res.status === 403)
        throw new Fatal("Google rejected this API key. Check that you copied the whole key from Google AI Studio.");
      errors.push(`${model}: ${res.status === 429 ? "daily/minute limit reached" : res.status === 503 ? "busy right now" : msg.slice(0, 90)}`);
    }
    throw new Error("All AI models failed. " + errors.join(" · ") + ". Wait a minute and try again.");
  }
  const textOf = (data) => ((data.candidates || [])[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");

  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.innerHTML; btn.textContent = label; } else if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
  function fail(e) { alert(e.message || String(e)); }

  // ---------- 1. script ----------
  const CERTAINTY = /\b(confirm(ed|s)?|it (has been|is) proven|undeniabl[ey]|without (a )?doubt|officials? said|sources say)\b/i;
  const wordsOf = (s) => (s.match(/[\p{L}\p{N}'’]+/gu) || []);

  $("genScript").addEventListener("click", async () => {
    const headline = $("headline").value.trim();
    if (!headline) { alert("Type a headline first."); return; }
    const secs = +$("length").value, target = Math.round(secs * 2.5);
    const btn = $("genScript"); busy(btn, true, "Writing script…");
    const system = `You write short, factual narration scripts for vertical news videos.
Rules you must never break:
- Never invent quotations, statistics, court decisions, arrests, resignations, evidence or details that are not in the headline or the user's notes.
- Match certainty to the source: if only a headline is given, use cautious wording such as "reports say" and say what is not yet confirmed.
- No section labels, stage directions, emojis, hashtags or notes in the script: only the words to be spoken.
- Neutral, fair language about every person and group.
- Do not attribute statements to anyone ("officials said", "leaders confirmed") unless the notes say who said it.
- Do not invent next steps, reactions, schedules, preparations or background. If you run short of facts, explain plainly what the given facts mean for ordinary people, or say what is not yet known.`;
    const prompt = `Headline (do not change it): ${headline}
Notes from the creator (the only facts you may use besides the headline): ${$("notes").value.trim() || "none"}
Tone: ${$("tone").value}. Language: ${$("lang").value}.
Length: about ${target} spoken words (${secs} seconds at a natural pace). Structure: a hook stating what happened, context, why it matters, what to watch next.
Return JSON with keys:
"script": the narration (plain sentences, about ${target} words),
"key_points": 3 to 4 objects {"text": max 7 words for an on-screen board, "anchor": 2-5 words copied exactly from the script where the board should appear},
"description": a 2-3 sentence social media description that does not add facts,
"hashtags": 5 to 8 relevant hashtags.`;
    try {
      const {data} = await gemini(models("textModels"), {
        systemInstruction: {parts: [{text: system}]},
        contents: [{role: "user", parts: [{text: prompt}]}],
        generationConfig: {responseMimeType: "application/json", temperature: 0.7}}, 120000);
      let txt = textOf(data).trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      pack = JSON.parse(txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1));
      $("script").value = String(pack.script || "").trim();
      $("points").value = (pack.key_points || []).map((k) => `${k.text} | ${k.anchor || ""}`).join("\n");
      $("desc").value = pack.description || "";
      $("tags").value = (pack.hashtags || []).map((h) => "#" + String(h).replace(/^#/, "").replace(/\s+/g, "")).join(" ");
      $("scriptOut").hidden = false;
      checkScript();
    } catch (e) { fail(e); } finally { busy(btn, false); }
  });

  function checkScript() {
    const s = $("script").value, n = wordsOf(s).length, secs = +$("length").value;
    $("scriptMeta").textContent = `${n} words · about ${Math.round(n / 2.5)} seconds of voice (target ${secs}s)`;
    const w = [];
    if (CERTAINTY.test(s) && !CERTAINTY.test($("notes").value)) w.push("The script sounds more certain than a headline supports (e.g. “confirmed”, “officials said”). Keep it only if your source says exactly that.");
    if (/[“"][^”"]{12,}[”"]/.test(s)) w.push("The script contains a quotation. Only keep it if you can point to the real source.");
    if (/\b(hook|context|conclusion|narrator|\[|\])\b/i.test(s) || /[*#]/.test(s)) w.push("Remove labels or symbols (like “Hook:” or *) so they are not read aloud.");
    if (n < secs * 2.5 * 0.7) w.push("The script is short for the chosen length.");
    if (n > secs * 2.5 * 1.25) w.push("The script is long; the video will run over the chosen length.");
    $("warnings").innerHTML = w.map((x) => `<p class="st-warn">${x}</p>`).join("");
  }
  $("script").addEventListener("input", checkScript);

  // ---------- 2. voice ----------
  function b64bytes(b64) { const bin = atob(b64), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function pcmToWav(pcm, rate) {
    const buf = new ArrayBuffer(44 + pcm.length), v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length, true);
    new Uint8Array(buf, 44).set(pcm); return new Blob([buf], {type: "audio/wav"});
  }
  let actx = null;
  const ctx = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());

  $("genVoice").addEventListener("click", async () => {
    const script = $("script").value.trim();
    if (!script) { alert("Write or paste a script in step 1 first."); return; }
    const btn = $("genVoice"); busy(btn, true, "Recording voice…");
    try {
      // Only the script is spoken. Accent + delivery go in the separate "style" field (the same Style box as
      // Google AI Studio's speech playground) - the voice follows it but never reads it aloud.
      const style = $("vstyle").value.trim(), accent = $("accent").value;
      const styleText = [accent && `${accent} accent`, style].filter(Boolean).join(". ");
      let audioB64 = "", mime = "";
      const errors = [];
      for (const model of models("ttsModels")) {
        try {
          const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
            method: "POST", signal: AbortSignal.timeout(180000),
            headers: {"content-type": "application/json", "x-goog-api-key": apiKey},
            body: JSON.stringify({model, response_format: {type: "audio"},
              generation_config: {speech_config: [{voice: $("voice").value}]},
              input: [{type: "user_input", content: [{type: "text", text: script,
                annotations: styleText ? [{type: "speech_metadata", style: styleText}] : []}]}]})});
          const j = await res.json().catch(() => ({}));
          if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(j.error?.message || "")))
            throw new Fatal("Google rejected this API key. Check that you copied the whole key from Google AI Studio.");
          if (!res.ok) { errors.push(`${model}: ${res.status === 429 ? "limit reached" : res.status === 503 ? "busy" : (j.error?.message || res.status).toString().slice(0, 80)}`); continue; }
          const a = (j.steps || []).flatMap((st) => st.content || []).find((c) => c.type === "audio" && c.data);
          if (a) { audioB64 = a.data; mime = a.mime_type || "audio/wav"; break; }
          errors.push(`${model}: no audio returned`);
        } catch (e) {
          if (e instanceof Fatal) throw e;
          errors.push(`${model}: ${e.name === "TimeoutError" ? "took too long" : "network error"}`);
        }
      }
      if (!audioB64) {
        // Backup route (older API): plain script only, so nothing but the script can ever be spoken.
        const {data} = await gemini(models("ttsModels"), {contents: [{role: "user", parts: [{text: script}]}],
          generationConfig: {responseModalities: ["AUDIO"], speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: $("voice").value}}}}}, 180000)
          .catch((e) => { throw new Error(e.message + (errors.length ? " (" + errors.join(" · ") + ")" : "")); });
        const part = ((data.candidates || [])[0]?.content?.parts || []).find((x) => x.inlineData);
        if (!part) throw new Error("The voice model returned no audio. Try again or pick another voice.");
        audioB64 = part.inlineData.data; mime = part.inlineData.mimeType || "";
        alert("Accent/style could not be applied right now, so the voice's default style was used.");
      }
      const bytes = b64bytes(audioB64);
      const rate = +(mime.match(/rate=(\d+)/) || [0, 24000])[1];
      const blob = /wav/i.test(mime) ? new Blob([bytes], {type: "audio/wav"}) : pcmToWav(bytes, rate);
      const buffer = await ctx().decodeAudioData(await blob.arrayBuffer());
      if (audio) URL.revokeObjectURL(audio.url);
      audio = {blob, buffer, url: URL.createObjectURL(blob)};
      $("audio").src = audio.url; $("dlAudio").href = audio.url; $("voiceOut").hidden = false;
    } catch (e) { fail(e); } finally { busy(btn, false); }
  });

  // ---------- 3. video ----------
  // Memory-safe media: ONE element per clip (metadata only), photos pre-scaled to the canvas size,
  // thumbnails are tiny images (no second video decoder per clip). Only 1-2 clips ever play at once.
  const MAX_MEDIA = 20;
  function thumb(src) { const im = new Image(); im.src = src; im.alt = ""; $("thumbs").appendChild(im); }
  async function addImage(f) {
    const url = URL.createObjectURL(f);
    try {
      const im = new Image(); im.src = url; await im.decode();
      const sc = Math.min(1, 1920 / Math.max(im.naturalWidth, im.naturalHeight));
      const bmp = await createImageBitmap(im, {resizeWidth: Math.max(1, Math.round(im.naturalWidth * sc)),
        resizeHeight: Math.max(1, Math.round(im.naturalHeight * sc)), resizeQuality: "high"});
      const tc = document.createElement("canvas"); tc.width = 64; tc.height = 100;
      const r = Math.max(64 / bmp.width, 100 / bmp.height);
      tc.getContext("2d").drawImage(bmp, (64 - bmp.width * r) / 2, (100 - bmp.height * r) / 2, bmp.width * r, bmp.height * r);
      thumb(tc.toDataURL("image/jpeg", 0.7));
      media.push({kind: "image", bmp});
    } finally { URL.revokeObjectURL(url); }
  }
  async function addVideo(f) {
    const url = URL.createObjectURL(f);
    const el = Object.assign(document.createElement("video"), {src: url, muted: true, loop: true, playsInline: true, preload: "metadata"});
    await new Promise((res, rej) => { el.onloadedmetadata = res; el.onerror = () => rej(new Error(f.name + " cannot be played in this browser.")); });
    el.currentTime = Math.min(1, (el.duration || 2) / 2);
    await new Promise((res) => { el.onseeked = res; setTimeout(res, 3000); });
    const tc = document.createElement("canvas"); tc.width = 64; tc.height = 100;
    try { const r = Math.max(64 / el.videoWidth, 100 / el.videoHeight); tc.getContext("2d").drawImage(el, (64 - el.videoWidth * r) / 2, (100 - el.videoHeight * r) / 2, el.videoWidth * r, el.videoHeight * r); } catch (e) { /* no frame */ }
    thumb(tc.toDataURL("image/jpeg", 0.7));
    media.push({kind: "video", el, url});
  }
  $("media").addEventListener("change", async (ev) => {
    const files = [...ev.target.files]; ev.target.value = "";
    for (const f of files) {
      if (media.length >= MAX_MEDIA) { alert(`Up to ${MAX_MEDIA} clips and photos per video.`); break; }
      try { if (f.type.startsWith("video")) await addVideo(f); else if (f.type.startsWith("image")) await addImage(f); }
      catch (e) { alert(e.message || `${f.name} could not be added.`); }
    }
  });
  $("clearMedia").addEventListener("click", () => {
    for (const m of media.splice(0)) { if (m.kind === "video") { m.el.pause(); m.el.removeAttribute("src"); m.el.load(); URL.revokeObjectURL(m.url); } else m.bmp.close?.(); }
    $("thumbs").innerHTML = "";
  });

  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function timeline(script, duration) {
    const words = script.split(/\s+/).filter(Boolean);
    const weight = (w) => w.length + 2 + (/[.!?]$/.test(w) ? 7 : /[,;:]$/.test(w) ? 3 : 0);
    const total = words.reduce((a, w) => a + weight(w), 0), lead = 0.12, span = Math.max(1, duration - lead - 0.25);
    let acc = 0;
    return words.map((w) => { const s = lead + (acc / total) * span; acc += weight(w); return {w, s, e: lead + (acc / total) * span}; });
  }
  function captionGroups(tl) {
    const groups = []; let cur = [];
    tl.forEach((x, i) => { cur.push(i); if (cur.length >= 4 || /[.!?,;:]$/.test(x.w)) { groups.push(cur); cur = []; } });
    if (cur.length) groups.push(cur);
    return groups.map((g) => ({idx: g, s: tl[g[0]].s, e: tl[g[g.length - 1]].e}));
  }
  function pointTimes(tl, duration) {
    const lines = $("points").value.split("\n").map((l) => l.split("|")).filter((p) => p[0].trim());
    const scriptNorm = tl.map((x) => norm(x.w));
    return lines.map(([text, anchor], i) => {
      let t = (duration / (lines.length + 1)) * (i + 1);
      const a = norm(anchor || "").split(" ").filter(Boolean);
      if (a.length) for (let k = 0; k <= scriptNorm.length - a.length; k++) if (a.every((w, j) => scriptNorm[k + j] === w)) { t = tl[k].s; break; }
      return {text: text.trim(), s: t, e: Math.min(duration, t + 3.6)};
    }).sort((x, y) => x.s - y.s).map((p, i, arr) => ({...p, e: i < arr.length - 1 ? Math.min(p.e, arr[i + 1].s - 0.1) : p.e}));
  }
  function wrapText(c, text, maxW) {
    const out = []; let line = "";
    for (const w of text.split(/\s+/)) { const t = line ? line + " " + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
    if (line) out.push(line); return out;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  function pickMime() {
    const list = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
  }

  $("render").addEventListener("click", async () => {
    const script = $("script").value.trim(), headline = $("headline").value.trim();
    if (!script || !audio) { alert("Create the script (step 1) and the voiceover (step 2) first."); return; }
    if (!window.MediaRecorder) { alert("This browser cannot record video. Please use Chrome on Android or a computer."); return; }
    const btn = $("render"); busy(btn, true, "Making video…");
    try { await makeVideo(script, headline); } catch (e) { fail(e); } finally { busy(btn, false); }
  });

  async function makeVideo(script, headline) {
    try { await Promise.race([document.fonts.load("800 40px Jakarta"), wait(1500)]); } catch (e) { /* fallback font */ }
    const H = +$("quality").value === 1080 ? 1920 : 1280, W = H * 9 / 16, u = W / 720;
    const cv = $("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
    const style = $("vidStyle").value, brand = $("brand").value.trim(), duration = audio.buffer.duration + 0.4;
    const tl = timeline(script, audio.buffer.duration), groups = captionGroups(tl), points = pointTimes(tl, audio.buffer.duration);
    const seg = 3;
    for (const m of media) if (m.kind === "video") m.el.pause();
    let active = new Set();
    function prepare(idx) {   // start a clip at a different point each time it is used; pause the rest
      const m = media[idx % media.length];
      if (m.kind !== "video" || active.has(idx) || [...active].some((k) => k % media.length === idx % media.length)) return;
      const d = m.el.duration || 0;
      try { m.el.currentTime = d > seg + 1 ? ((idx * 1.7) % (d - seg)) : 0; } catch (e) { /* not seekable yet */ }
      m.el.play().catch(() => {});
      active.add(idx);
    }
    function release(idx) {
      active.delete(idx);
      const m = media[idx % media.length];
      if (m && m.kind === "video" && ![...active].some((k) => k % media.length === idx % media.length)) m.el.pause();
    }

    const a = ctx(); if (a.state === "suspended") await Promise.race([a.resume(), wait(1500)]);
    const dest = a.createMediaStreamDestination(), src = a.createBufferSource();
    src.buffer = audio.buffer; src.connect(dest);
    const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime(), rec = new MediaRecorder(stream, mime ? {mimeType: mime, videoBitsPerSecond: H > 1300 ? 8e6 : 5e6} : undefined), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    $("prog").hidden = false; $("videoOut").hidden = true;

    function drawMedia(m, t, alpha) {
      const el = m.kind === "image" ? m.bmp : m.el, iw = m.kind === "image" ? el.width : el.videoWidth, ih = m.kind === "image" ? el.height : el.videoHeight;
      if (!iw || !ih) return;
      const z = 1.0 + 0.07 * (t % seg) / seg, sc = Math.max(W / iw, H / ih) * z;
      c.globalAlpha = alpha; c.drawImage(el, (W - iw * sc) / 2, (H - ih * sc) / 2, iw * sc, ih * sc); c.globalAlpha = 1;
    }
    function frame(t) {
      // background
      const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#2a1065"); g.addColorStop(1, "#0f2a6b");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      if (media.length) {
        const i = Math.floor(t / seg), f = (t % seg) / seg;
        for (const k of [...active]) if (k < i) release(k);
        prepare(i); if (f > 0.85) prepare(i + 1);
        drawMedia(media[i % media.length], t, 1);
        if (f > 0.9 && media.length > 1) drawMedia(media[(i + 1) % media.length], t, (f - 0.9) / 0.1);
      } else {
        c.fillStyle = "rgba(255,255,255,.06)"; for (let k = 0; k < 12; k++) { c.beginPath(); c.arc((k * 173 + t * 30) % W, (k * 271) % H, 60 * u, 0, 7); c.fill(); }
      }
      const sh = c.createLinearGradient(0, 0, 0, H);
      sh.addColorStop(0, "rgba(10,6,30,.82)"); sh.addColorStop(0.32, "rgba(10,6,30,.15)"); sh.addColorStop(0.6, "rgba(10,6,30,.2)"); sh.addColorStop(1, "rgba(10,6,30,.85)");
      c.fillStyle = sh; c.fillRect(0, 0, W, H);

      // headline
      c.font = `800 ${46 * u}px Jakarta, sans-serif`; c.textBaseline = "top";
      const hl = wrapText(c, headline.toUpperCase(), W - 110 * u).slice(0, 4), lh = 54 * u, hy = 120 * u;
      if (style === "dynamic") {
        const p = ease(t / 0.6), bh = hl.length * lh + 44 * u;
        const bg = c.createLinearGradient(0, 0, W, 0); bg.addColorStop(0, "#7c3aed"); bg.addColorStop(1, "#2563eb");
        c.save(); c.translate(-W * (1 - p), 0); c.fillStyle = bg; rr(c, 30 * u, hy - 22 * u, W - 60 * u, bh, 22 * u); c.fill(); c.restore();
        c.fillStyle = "#fff"; c.globalAlpha = ease((t - 0.25) / 0.4); hl.forEach((l, k) => c.fillText(l, 55 * u, hy + k * lh)); c.globalAlpha = 1;
      } else if (style === "typing") {
        const chars = Math.floor(Math.max(0, t) * 38); let left = chars;
        c.fillStyle = "#fff"; hl.forEach((l, k) => { const part = l.slice(0, Math.max(0, left)); left -= l.length + 1; c.fillText(part, 55 * u, hy + k * lh); });
        if (chars < headline.length && Math.floor(t * 3) % 2 === 0) { c.fillStyle = "#a78bfa"; c.fillRect(W - 60 * u, hy, 6 * u, lh * 0.8); }
      } else {
        c.globalAlpha = ease(t / 0.8); c.fillStyle = "#fff"; c.shadowColor = "rgba(0,0,0,.6)"; c.shadowBlur = 14 * u;
        hl.forEach((l, k) => c.fillText(l, 55 * u, hy + k * lh)); c.shadowBlur = 0; c.globalAlpha = 1;
      }

      // key point boards
      for (const p of points) {
        if (t < p.s || t > p.e) continue;
        const inP = ease((t - p.s) / 0.45), outP = ease((p.e - t) / 0.35), k = Math.min(inP, outP);
        c.font = `800 ${38 * u}px Jakarta, sans-serif`;
        const lines = wrapText(c, p.text, W - 170 * u).slice(0, 3), bh = lines.length * 46 * u + 48 * u, by = H * 0.46;
        c.save();
        if (style === "dynamic") c.translate(-(1 - k) * W * 0.6, 0); else c.globalAlpha = k;
        c.fillStyle = "rgba(255,255,255,.96)"; rr(c, 40 * u, by, W - 80 * u, bh, 22 * u); c.fill();
        const sg = c.createLinearGradient(0, by, 0, by + bh); sg.addColorStop(0, "#7c3aed"); sg.addColorStop(1, "#2563eb");
        c.fillStyle = sg; rr(c, 40 * u, by, 14 * u, bh, 7 * u); c.fill();
        c.fillStyle = "#0f0a2a";
        lines.forEach((l, i) => { const shown = style === "typing" ? l.slice(0, Math.floor((t - p.s) * 40) - i * 12) : l; c.fillText(shown, 78 * u, by + 26 * u + i * 46 * u); });
        c.restore();
      }

      // captions (current word highlighted)
      const gi = groups.find((gr) => t >= gr.s - 0.05 && t <= gr.e + 0.15);
      if (gi) {
        c.font = `800 ${44 * u}px Jakarta, sans-serif`; c.textBaseline = "middle";
        const parts = gi.idx.map((i) => tl[i]), space = c.measureText(" ").width;
        const rows = []; let row = [], rw = 0;
        for (const x of parts) { const ww = c.measureText(x.w).width; if (rw + ww > W - 120 * u && row.length) { rows.push(row); row = []; rw = 0; } row.push({...x, ww}); rw += ww + space; }
        rows.push(row);
        rows.forEach((r, ri) => {
          const total = r.reduce((s2, x) => s2 + x.ww + space, -space); let x0 = (W - total) / 2; const y = H * 0.76 + ri * 58 * u;
          for (const x of r) {
            const on = t >= x.s && t < x.e + 0.05;
            if (on) { c.fillStyle = "#7c3aed"; rr(c, x0 - 8 * u, y - 30 * u, x.ww + 16 * u, 60 * u, 12 * u); c.fill(); }
            c.lineWidth = 8 * u; c.strokeStyle = "rgba(10,6,30,.9)"; c.lineJoin = "round"; c.strokeText(x.w, x0, y);
            c.fillStyle = "#fff"; c.fillText(x.w, x0, y); x0 += x.ww + space;
          }
        });
        c.textBaseline = "top";
      }

      // brand + progress
      if (brand) { c.font = `700 ${24 * u}px Jakarta, sans-serif`; const bw = c.measureText(brand).width + 36 * u; c.fillStyle = "rgba(124,58,237,.9)"; rr(c, 40 * u, H - 112 * u, bw, 44 * u, 22 * u); c.fill(); c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(brand, 58 * u, H - 90 * u); c.textBaseline = "top"; }
      c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(0, H - 8 * u, W, 8 * u);
      c.fillStyle = "#8b5cf6"; c.fillRect(0, H - 8 * u, W * Math.min(1, t / duration), 8 * u);
    }

    let left = false, stalled = false, lock = null;
    const onHide = () => { if (document.hidden) left = true; };
    document.addEventListener("visibilitychange", onHide);
    try { lock = await navigator.wakeLock?.request("screen"); } catch (e) { /* not supported: rely on stall check */ }
    try {
      frame(0);
      rec.start(500);
      src.start(a.currentTime + 0.15); const t0 = performance.now() + 150;
      await new Promise((resolve) => {
        let last = performance.now();
        const tick = () => {
          const now = performance.now(), t = (now - t0) / 1000;
          // Browsers stop drawing when the screen dims/locks, the app is switched or battery saver throttles.
          // Sound keeps recording, so the picture would end early: stop and say so instead.
          if (now - last > 1200 && t > 0.5) stalled = true;
          last = now;
          if (left || stalled) return resolve();
          frame(Math.max(0, t));
          $("progBar").style.width = Math.min(100, (t / duration) * 100) + "%";
          $("progText").textContent = `Recording ${Math.max(0, Math.min(duration, t)).toFixed(0)} / ${duration.toFixed(0)} s. Keep this tab open and the screen on.`;
          if (t >= duration) return resolve();
          requestAnimationFrame(tick);
        };
        tick();
      });
    } finally {
      document.removeEventListener("visibilitychange", onHide);
      try { await lock?.release(); } catch (e) { /* already released */ }
      try { if (rec.state !== "inactive") rec.stop(); } catch (e) { /* already stopped */ }
      try { src.stop(); } catch (e) { /* not started */ }
      src.disconnect();
      for (const m of media) if (m.kind === "video") m.el.pause();
      active = new Set();
      await Promise.race([done, wait(3000)]);
      stream.getTracks().forEach((tr) => tr.stop());
    }
    if (left || stalled) {
      $("progText").textContent = left ? "Recording stopped because the app or tab was switched. Keep this tab open and try again."
        : "Recording stopped: the phone paused drawing (screen dimmed or locked, or battery saver). Keep the screen on, turn off battery saver, and try again.";
      return;
    }
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    const blob = new Blob(chunks, {type}), url = URL.createObjectURL(blob);
    if (lastVideoUrl) URL.revokeObjectURL(lastVideoUrl);
    lastVideoUrl = url;
    $("outVideo").src = url; $("dlVideo").href = url; $("dlVideo").download = "ai-video." + (type.includes("mp4") ? "mp4" : "webm");
    $("videoOut").hidden = false; $("progText").textContent = `Done: ${(blob.size / 1048576).toFixed(1)} MB ${type.includes("mp4") ? "MP4" : "WebM"} video.`;
  }

  // ---------- 4. post pack ----------
  $("copyPack").addEventListener("click", async () => {
    const text = ($("desc").value.trim() + "\n\n" + $("tags").value.trim()).trim();
    try { await navigator.clipboard.writeText(text); $("copyPack").textContent = "Copied"; } catch (e) { prompt("Copy this:", text); }
  });
})();
