// Studydot: make study sets (a term and its answer on each card) and learn them
// with flashcards or a quiz. Everything is saved in this browser, and to your
// account when you're logged in (see sync.js).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const KEY = "studydot:data";
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Sets are kept even after deleting (as { id, deleted: true }) so other devices
  // learn about the delete when they sync.
  let data = { sets: [], settings: { color: "blue", dark: false, name: "" }, settingsUpdated: 0, days: {}, stats: {} };

  const COLORS = {
    blue:   { pastel: "#cfe0f7", accent: "#3d5a80" },
    pink:   { pastel: "#f8d3e0", accent: "#8a3b5a" },
    green:  { pastel: "#cdebd6", accent: "#2f6b45" },
    purple: { pastel: "#e1d6f5", accent: "#5b3f8c" },
    orange: { pastel: "#fbdcc4", accent: "#8a4b1f" },
    gray:   { pastel: "#e0e0e0", accent: "#474747" },
  };

  /* ---------- languages ---------- */
  // Each set can say what language its terms and answers are in. That decides the
  // accent buttons shown while typing, the voice used to read words out loud, and,
  // for Mandarin, an extra Pinyin box on each card.
  const PINYIN_KEYS = "ā á ǎ à ē é ě è ī í ǐ ì ō ó ǒ ò ū ú ǔ ù ǖ ǘ ǚ ǜ ü";
  const LANGS = {
    "":  { name: "None",     voice: "",      keys: "" },
    en:  { name: "English",  voice: "en-US", keys: "" },
    es:  { name: "Spanish",  voice: "es-ES", keys: "á é í ó ú ñ ü ¿ ¡" },
    fr:  { name: "French",   voice: "fr-FR", keys: "é è ê ë à â ç î ï ô û ù ü œ" },
    la:  { name: "Latin",    voice: "",      keys: "ā ē ī ō ū ȳ" },
    zh:  { name: "Mandarin", voice: "zh-CN", keys: "" },
  };
  const langName = (code, fallback) => (code && LANGS[code] ? LANGS[code].name : fallback);
  const isZh = (s) => s && s.lang === "zh";

  // Read a word out loud with the phone's or computer's built-in voice.
  const canSpeak = (code) => !!(code && LANGS[code] && LANGS[code].voice && "speechSynthesis" in window);
  function speak(text, code) {
    if (!canSpeak(code) || !text) return;
    const voiceLang = LANGS[code].voice;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voiceLang;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").startsWith(voiceLang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // Turn "ni3 hao3" into "nǐ hǎo", so pinyin can be typed with tone numbers.
  const TONES = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", "ü": "ǖǘǚǜ" };
  function numberedToMarks(text) {
    return text.toLowerCase().replace(/v/g, "ü").replace(/u:/g, "ü").replace(/([a-zü]+)([1-5])/g, (m, syl, tone) => {
      const t = Number(tone);
      if (t === 5) return syl;
      let i = syl.search(/[ae]/);
      if (i < 0) i = syl.indexOf("ou");
      if (i < 0) { for (let k = syl.length - 1; k >= 0; k--) if (TONES[syl[k]]) { i = k; break; } }
      if (i < 0) return syl;
      return syl.slice(0, i) + TONES[syl[i]][t - 1] + syl.slice(i + 1);
    });
  }
  const stripMarks = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  const tidy = (s) => s.toLowerCase().normalize("NFC").replace(/[.,!?¿¡;:"“”()]/g, "").replace(/['’]/g, "'").replace(/\s+/g, " ").trim();

  // Check a typed answer. Answers like "to love, to like" or "big / large" accept any part.
  // Returns "right", "accents" (right except for accents or tones) or "wrong".
  function checkAnswer(typed, answer, pinyin) {
    const fix = (s) => tidy(pinyin ? numberedToMarks(s) : s);
    const t = fix(typed);
    if (!t) return "wrong";
    const options = [answer, ...answer.split(/[,;/]/)].map(fix).filter(Boolean);
    const squash = (s) => (pinyin ? s.replace(/[\s']/g, "") : s);
    if (options.some((o) => squash(o) === squash(t))) return "right";
    if (options.some((o) => squash(stripMarks(o)) === squash(stripMarks(t)))) return "accents";
    return "wrong";
  }

  // A row of accent buttons that types into whichever box has focus.
  function fillKeys(bar, keys) {
    bar.innerHTML = keys ? keys.split(" ").map((k) => `<button type="button" class="key" data-key="${k}">${k}</button>`).join("") : "";
    bar.hidden = !keys;
  }
  function typeInto(el, text) {
    if (!el) return;
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  }

  /* ---------- saving ---------- */
  function loadLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && Array.isArray(saved.sets)) data = { sets: saved.sets, settings: { ...data.settings, ...saved.settings }, settingsUpdated: saved.settingsUpdated || 0, days: saved.days || {}, stats: saved.stats || {} };
    } catch { /* nothing saved yet */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
    if (window.studydotSync) window.studydotSync.queue();
  }
  // Your sets are shown in their saved order (each set's "pos"; lower comes first),
  // which you can change in Edit mode. New sets go to the top.
  const byPos = (a, b) => (a.pos ?? 0) - (b.pos ?? 0);
  const liveSets = () => data.sets.filter((s) => !s.deleted).sort(byPos);
  const topPos = () => Math.min(0, ...data.sets.filter((s) => !s.deleted && s.pos != null).map((s) => s.pos)) - 1;
  // Older sets made before ordering existed get a place, newest first, above the rest.
  function ensurePos() {
    const missing = data.sets.filter((s) => !s.deleted && s.pos == null).sort((a, b) => (a.updated || 0) - (b.updated || 0));
    missing.forEach((s) => { s.pos = topPos(); });
    data.sets.forEach((s) => { if (!s.deleted && !s.created) s.created = s.updated || Date.now(); });
  }
  const SAT = window.SAT_SETS || [];
  // Ready-made language units (courses/*.js): one set per unit, grouped by language and level.
  const COURSES = window.COURSES || [];
  const COURSE_SETS = COURSES.flatMap((c) => c.levels.flatMap((lv, li) => lv.units.map((u, ui) => {
    const id = `${c.lang}-${li}-${ui}`;
    return {
      id, title: `${lv.name}: ${u.title}`, unit: u.title, builtIn: true, course: c.lang, level: li,
      lang: c.lang, lang2: "en",
      cards: u.cards.map((x, i) => (c.lang === "zh"
        ? { id: `${id}-${i}`, term: x[0], pin: x[1], def: x[2] }
        : { id: `${id}-${i}`, term: x[0], def: x[1] })),
    };
  })));
  const BUILT_IN = [...SAT, ...COURSE_SETS];
  const findSet = (id) => data.sets.find((s) => s.id === id && !s.deleted) || BUILT_IN.find((s) => s.id === id);
  const addedCopy = (id) => data.sets.find((s) => s.from === id && !s.deleted);
  // Copy a ready-made set into your own sets, so you can study it from there and change it.
  function saveCopy(id) {
    const src = BUILT_IN.find((s) => s.id === id);
    if (!src) return;
    if (addedCopy(id)) { toast("It's already in your sets"); return; }
    const copy = { id: uid(), pos: topPos(), created: Date.now(), from: src.id, title: src.title, lang: src.lang, lang2: src.lang2, updated: Date.now(),
      cards: src.cards.map((c) => ({ id: uid(), term: c.term, def: c.def, ...(c.pin ? { pin: c.pin } : {}) })) };
    data.sets.unshift(copy);
    save(); render();
    toast(`Added "${src.title}" to your sets`);
  }

  /* ---------- sharing a set with a link ---------- */
  // The whole set is packed into the link itself (compressed), so sharing needs no
  // account and nothing is stored online. Library sets just link to their id.
  const SITE = "https://mmmiks505.github.io/studydot/";
  const toB64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fromB64 = (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function packSet(s) {
    const json = JSON.stringify({ t: s.title, l: s.lang || "", l2: s.lang2 || "", c: s.cards.map((c) => (c.pin ? [c.term, c.def, c.pin] : [c.term, c.def])) });
    const bytes = new TextEncoder().encode(json);
    if ("CompressionStream" in window) {
      try { return "z" + toB64(await pipe(bytes, new CompressionStream("deflate-raw"))); } catch { /* fall back below */ }
    }
    return "j" + toB64(bytes);
  }
  async function unpackSet(code) {
    let bytes = fromB64(code.slice(1));
    if (code[0] === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (!p || typeof p.t !== "string" || !Array.isArray(p.c)) throw new Error("bad link");
    return p;
  }
  // A short fingerprint of a shared set, so adding the same link twice is noticed.
  const fingerprint = (str) => { let h = 5381; for (const ch of str) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36); };
  async function shareSet(s) {
    let url;
    try { url = SITE + (s.builtIn && !s.shared && !s.mixed ? `#open=${s.id}` : `#share=${await packSet(s)}`); }
    catch { toast("Couldn't make a link for this set"); return; }
    const text = `Study "${s.title}" with me on Studydot`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: s.title, text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Link copied. Paste it to share."); }
    catch { window.prompt("Copy this link to share the set:", url); }
  }
  // A mixed set: the cards of several sets studied as one. Each card remembers its
  // own set (_set), so tricky words still count toward the set it came from.
  function makeMix(ids) {
    const sets = ids.map(findSet).filter(Boolean);
    if (sets.length < 2) return null;
    const id = "mix-" + fingerprint(sets.map((x) => x.id).join(","));
    if (!BUILT_IN.some((x) => x.id === id)) {
      const same = (k) => (sets.every((x) => (x[k] || "") === (sets[0][k] || "")) ? sets[0][k] || "" : "");
      const names = sets.map((x) => x.unit || x.title);
      BUILT_IN.push({
        id, builtIn: true, mixed: true, lang: same("lang"), lang2: same("lang2"),
        title: names.length <= 3 ? names.join(" + ") : `${names[0]} + ${names.length - 1} more`,
        cards: sets.flatMap((x) => x.cards.map((c) => ({ ...c, _set: c._set || x.id }))),
      });
    }
    return id;
  }

  // Opening a shared link shows the set; you can study it or add it to your sets.
  async function openLink() {
    const hash = location.hash.slice(1);
    const clear = () => history.replaceState(null, "", location.pathname + location.search + "#sets");
    if (hash.startsWith("open=")) {
      const id = decodeURIComponent(hash.slice(5));
      clear(); showTab();
      if (findSet(id)) openSet(id); else toast("That set isn't available anymore");
      return true;
    }
    if (!hash.startsWith("share=")) return false;
    const code = hash.slice(6);
    clear(); showTab();
    try {
      const p = await unpackSet(code);
      const id = "share-" + fingerprint(code);
      if (!BUILT_IN.some((s) => s.id === id)) {
        BUILT_IN.push({ id, builtIn: true, shared: true, title: p.t, lang: p.l, lang2: p.l2,
          cards: p.c.filter((x) => Array.isArray(x) && x.length >= 2).map((x, i) => ({ id: `${id}-${i}`, term: String(x[0]), def: String(x[1]), ...(x[2] ? { pin: String(x[2]) } : {}) })) });
      }
      openSet(id);
      toast("Someone shared this set with you");
    } catch {
      toast("This share link looks broken. Ask for a new one.");
    }
    return true;
  }

  // Cards studied per day ({ "2026-11-20": 12 }). Devices are combined by taking the higher count.
  function mergeDays(a = {}, b = {}) {
    const out = { ...a };
    for (const [d, n] of Object.entries(b)) out[d] = Math.max(out[d] || 0, n);
    return Object.fromEntries(Object.entries(out).sort().slice(-400));
  }

  // How you've done on each card ({ "setId|cardId": { m: times missed, s: right in a row, t: when } }).
  // Devices are combined by keeping each card's most recent record.
  function mergeStats(a = {}, b = {}) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) if (!out[k] || (v.t || 0) > (out[k].t || 0)) out[k] = v;
    return Object.fromEntries(Object.entries(out).sort());
  }

  // Used by sync.js: combine the account's copy with this device's, set by set
  // (the most recently changed copy of each set wins).
  window.studydot = {
    snapshot: () => JSON.parse(JSON.stringify(data)),
    merge(a, b) {
      const byId = new Map();
      for (const s of [...(a.sets || []), ...(b.sets || [])]) {
        const old = byId.get(s.id);
        if (!old || (s.updated || 0) > (old.updated || 0)) byId.set(s.id, s);
      }
      const settings = (a.settingsUpdated || 0) > (b.settingsUpdated || 0) ? a.settings : b.settings;
      return {
        sets: [...byId.values()].sort((x, y) => (y.updated || 0) - (x.updated || 0)),
        settings: { ...data.settings, ...settings },
        settingsUpdated: Math.max(a.settingsUpdated || 0, b.settingsUpdated || 0),
        days: mergeDays(a.days, b.days),
        stats: mergeStats(a.stats, b.stats),
      };
    },
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    load(next) {
      data = { sets: next.sets || [], settings: { ...data.settings, ...next.settings }, settingsUpdated: next.settingsUpdated || 0, days: next.days || {}, stats: next.stats || {} };
      ensurePos();
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
      applySettings(); render();
    },
    clearLocal() {
      data = { sets: [], settings: { color: "blue", dark: false, name: "" }, settingsUpdated: 0, days: {}, stats: {} };
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      applySettings(); render();
    },
  };
  function settingsChanged() { data.settingsUpdated = Date.now(); save(); }

  /* ---------- little helpers ---------- */
  let toastTimer;
  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }
  window.askConfirm = (text, yes = "OK") => new Promise((resolve) => {
    $("dialog-text").textContent = text;
    $("dialog-yes").textContent = yes;
    $("dialog").hidden = false;
    const done = (v) => { $("dialog").hidden = true; $("dialog-yes").onclick = $("dialog-no").onclick = null; resolve(v); };
    $("dialog-yes").onclick = () => done(true);
    $("dialog-no").onclick = () => done(false);
    $("dialog-yes").focus();
  });
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function ago(t) {
    if (!t) return "";
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;
    return new Date(t).toLocaleDateString();
  }

  /* ---------- full-screen pages ---------- */
  // Each open page is remembered so Back (and the phone's back gesture) closes it.
  const stack = [];
  function openScreen(id) {
    if (stack[stack.length - 1] === id) return;
    stack.push(id);
    $(id).hidden = false;
    $(id).scrollTop = 0;
    document.body.style.overflow = "hidden";
  }
  function closeScreen() {
    const id = stack.pop();
    if (id) $(id).hidden = true;
    if (!stack.length) document.body.style.overflow = "";
    // Leaving a study page: refresh what's behind it (tricky words, streak).
    if (id && $(id).classList.contains("study-screen")) render();
  }
  function closeAll() { while (stack.length) closeScreen(); }
  window.openOverlay = openScreen;
  window.closeOverlay = closeScreen;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("dialog").hidden) { $("dialog-no").click(); return; }
    if (e.key === "Escape" && stack.length) closeScreen();
  });

  /* ---------- tabs ---------- */
  const TABS = ["sets", "library", "profile"];
  function showTab() {
    let tab = location.hash.slice(1);
    // Old links to the Languages or SAT tabs open that part of the Library.
    if (tab === "langs" || tab === "sat") { pick.lib = tab; savePick(); renderLibrary(); tab = "library"; }
    if (!TABS.includes(tab)) tab = "sets";
    closeAll();
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== tab; });
    document.querySelectorAll(".tab").forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", async () => { if (!(await openLink())) showTab(); });

  /* ---------- Sets tab ---------- */
  let editMode = false;
  const selected = new Set();
  // Save a new order: each set's place in the list becomes its "pos".
  function setOrder(list) {
    const now = Date.now();
    list.forEach((s, i) => { if (s.pos !== i) { s.pos = i; s.updated = now; } });
    save(); render();
  }
  $("edit-sets").addEventListener("click", () => { editMode = true; selected.clear(); render(); });
  $("edit-done").addEventListener("click", () => { editMode = false; selected.clear(); render(); });
  $("select-all").addEventListener("click", () => {
    const sets = liveSets();
    if (selected.size === sets.length) selected.clear(); else sets.forEach((s) => selected.add(s.id));
    render();
  });
  $("sets-list").addEventListener("change", (e) => {
    const box = e.target.closest("[data-select]");
    if (!box) return;
    if (box.checked) selected.add(box.dataset.select); else selected.delete(box.dataset.select);
    render();
  });
  $("sets-list").addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
      return;
    }
    const mv = e.target.closest("[data-move]");
    if (!mv) return;
    const list = liveSets();
    const i = list.findIndex((s) => s.id === mv.dataset.move), j = i + Number(mv.dataset.dir);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
  });
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    const list = liveSets();
    const sorts = {
      az: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }),
      new: (a, b) => (b.created || 0) - (a.created || 0),
      studied: (a, b) => (b.studied || 0) - (a.studied || 0),
    };
    setOrder(list.sort(sorts[b.dataset.sort]));
    toast(`Sorted ${b.textContent}`);
  }));
  $("mix-selected").addEventListener("click", () => {
    const ids = liveSets().filter((x) => selected.has(x.id)).map((x) => x.id);
    const id = makeMix(ids);
    if (!id) return;
    editMode = false; selected.clear(); render();
    openSet(id);
  });
  $("delete-selected").addEventListener("click", async () => {
    const n = selected.size;
    if (!n) return;
    const names = liveSets().filter((s) => selected.has(s.id)).map((s) => `"${s.title}"`);
    const what = n === 1 ? names[0] : plural(n, "set");
    if (!(await askConfirm(`Delete ${what}? This can't be undone.`, "Delete"))) return;
    const now = Date.now();
    data.sets = data.sets.map((x) => (selected.has(x.id) ? { id: x.id, deleted: true, updated: now } : x));
    selected.clear();
    save(); render();
    toast(n === 1 ? "Set deleted" : `${n} sets deleted`);
  });

  function render() {
    const sets = liveSets();
    $("sets-count").textContent = sets.length ? plural(sets.length, "set") : "";
    $("sets-empty").hidden = sets.length > 0;
    if (!sets.length) editMode = false;
    $("sets-head").hidden = editMode || !sets.length;
    $("edit-bar").hidden = !editMode;
    $("delete-selected").hidden = !editMode;
    selected.forEach((id) => { if (!findSet(id) || findSet(id).builtIn) selected.delete(id); });
    $("delete-selected").disabled = !selected.size;
    const picked = liveSets().filter((x) => selected.has(x.id));
    const langOf = (x) => `${x.lang || ""}|${x.lang2 || ""}`;
    const sameLang = picked.every((x) => langOf(x) === langOf(picked[0]));
    $("mix-selected").hidden = !editMode;
    $("mix-selected").disabled = picked.length < 2 || !sameLang;
    $("mix-selected").textContent = picked.length >= 2 && !sameLang ? "Pick sets in the same language to mix" : picked.length >= 2 ? `🔀 Study ${plural(picked.length, "set")} together` : "🔀 Study together";
    $("delete-selected").textContent = selected.size ? `Delete ${plural(selected.size, "set")}` : "Delete";
    $("select-all").textContent = selected.size === sets.length ? "Select none" : "Select all";
    const meta = (s) => `${s.lang && s.lang !== "en" ? `${langName(s.lang)} · ` : ""}${plural(s.cards.length, "card")}${s.studied ? ` · studied ${ago(s.studied)}` : ""}`;
    $("sets-list").innerHTML = editMode
      ? sets.map((s, i) => `
      <li class="set-row editing${selected.has(s.id) ? " checked" : ""}">
        <label class="check"><input type="checkbox" data-select="${s.id}" ${selected.has(s.id) ? "checked" : ""} aria-label="Select ${esc(s.title)}"><span></span></label>
        <span class="set-info" data-toggle="${s.id}"><span class="set-name">${esc(s.title)}</span><span class="set-meta">${meta(s)}</span></span>
        <span class="move-btns">
          <button type="button" data-move="${s.id}" data-dir="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" data-move="${s.id}" data-dir="1" aria-label="Move down" ${i === sets.length - 1 ? "disabled" : ""}>↓</button>
        </span>
      </li>`).join("")
      : sets.map((s) => `
      <li><button type="button" class="set-row" data-open="${s.id}">
        <span class="set-badge">${esc((s.title.trim()[0] || "?").toLowerCase())}</span>
        <span class="set-info"><span class="set-name">${esc(s.title)}</span>
          <span class="set-meta">${meta(s)}</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button></li>`).join("");

    renderLibrary();
    renderStreak();
    const tricky = trickyCards().length;
    $("review-tricky").hidden = !tricky;
    $("review-tricky").innerHTML = `<span>🎯</span><span><strong>Review ${plural(tricky, "tricky word")}</strong><small>The cards you keep missing, from all your sets</small></span><span class="chev">›</span>`;
    if (currentSet && !$("set-screen").hidden) renderSet();
  }

  /* ---------- Library tab: Languages (language → level → units) and SAT (by subject) ---------- */
  const PICK_KEY = "studydot:langpick";
  let pick = { lib: "langs", lang: "", level: 0, subject: "Vocabulary" };
  try { pick = { ...pick, ...JSON.parse(localStorage.getItem(PICK_KEY)) }; } catch { /* first visit */ }
  const savePick = () => { try { localStorage.setItem(PICK_KEY, JSON.stringify(pick)); } catch { /* ignore */ } };
  const SUBJECTS = [["Vocabulary", "A"], ["Reading & Writing", "✎"], ["Math", "∑"]];
  // "Spanish 3" → "Level 3", "AP Chinese" → "AP", "Heritage French" → "Heritage".
  function levelLabel(name, langName) {
    if (/\d$/.test(name)) return "Level " + name.match(/\d+$/)[0];
    return name.replace(langName, "").replace("Chinese", "").trim() || name;
  }
  const chip = (attr, value, on, label) =>
    `<button type="button" class="chip" role="radio" aria-checked="${on}" ${attr}="${esc(value)}">${label}</button>`;
  // One row: tap it to open the set (where the study buttons are), or + Add it to your sets.
  // In Mix mode, tapping a row checks it instead.
  function libRow(s, badge, name, meta) {
    if (mixMode) {
      const on = mixSel.has(s.id);
      return `
      <li class="lib-row mixing${on ? " checked" : ""}">
        <button type="button" class="lib-open" data-mixpick="${s.id}" aria-pressed="${on}">
          <span class="check"><span></span></span>
          <span class="set-info"><span class="set-name">${esc(name)}</span><span class="set-meta">${esc(meta)}</span></span>
        </button>
      </li>`;
    }
    const added = addedCopy(s.id);
    return `
      <li class="lib-row">
        <button type="button" class="lib-open" data-open="${s.id}">
          <span class="set-badge">${badge}</span>
          <span class="set-info"><span class="set-name">${esc(name)}</span><span class="set-meta">${esc(meta)}</span></span>
        </button>
        <button type="button" class="add-unit ${added ? "added" : "primary"}" data-add="${s.id}" ${added ? "disabled" : ""}>${added ? "✓ Added" : "+ Add"}</button>
      </li>`;
  }
  // Mix mode: check several sets from the same section (one language, or SAT) and study them together.
  let mixMode = false, mixScope = "";
  const mixSel = new Set();
  const libScope = () => (pick.lib === "sat" ? "sat" : (COURSES.find((c) => c.lang === pick.lang) || COURSES[0] || {}).lang);
  function renderMixBar() {
    const n = mixSel.size;
    const cards = [...mixSel].reduce((t, id) => t + (findSet(id) ? findSet(id).cards.length : 0), 0);
    $("mix-toggle").textContent = mixMode ? "Done" : "🔀 Mix sets";
    $("mix-toggle").classList.toggle("primary", mixMode);
    $("mix-hint").textContent = mixMode ? (pick.lib === "sat" ? "Pick SAT sets from any subject" : "Pick units from any level of this language") : "";
    $("mix-bar").hidden = !mixMode;
    $("mix-count").textContent = n ? `${plural(n, "set")} · ${plural(cards, "card")}` : "Pick 2 or more sets";
    $("mix-go").disabled = n < 2;
    document.querySelector(".lib-hint").hidden = mixMode;
  }
  function renderLibrary() {
    if (mixScope !== libScope()) { mixScope = libScope(); mixSel.clear(); }
    renderMixBar();
    document.querySelectorAll("[data-lib]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lib === pick.lib));
    $("lib-langs").hidden = pick.lib !== "langs";
    $("lib-sat").hidden = pick.lib !== "sat";

    // Languages
    const course = COURSES.find((c) => c.lang === pick.lang) || COURSES[0];
    if (course) {
      if (!course.levels[pick.level]) pick.level = 0;
      $("lang-pick").innerHTML = COURSES.map((c) => chip("data-pick-lang", c.lang, c === course, `${c.icon} ${esc(c.name)}`)).join("");
      $("level-pick").innerHTML = course.levels.map((lv, i) => chip("data-pick-level", i, i === pick.level, esc(levelLabel(lv.name, course.name)))).join("");
      const units = COURSE_SETS.filter((s) => s.course === course.lang && s.level === pick.level);
      $("unit-list").innerHTML = units.map((s, i) => libRow(s, i + 1, s.unit, plural(s.cards.length, "word"))).join("");
    }

    // SAT
    const [subject, badge] = SUBJECTS.find(([n]) => n === pick.subject) || SUBJECTS[0];
    $("sat-pick").innerHTML = SUBJECTS.map(([n]) => chip("data-pick-subject", n, n === subject, esc(n))).join("");
    $("sat-list").innerHTML = SAT.filter((s) => (s.subject || "Vocabulary") === subject)
      .map((s) => libRow(s, badge, s.title.replace(/^SAT (Math: )?/, ""), `${s.blurb} · ${plural(s.cards.length, "card")}`)).join("");
  }
  $("mix-toggle").addEventListener("click", () => { mixMode = !mixMode; mixSel.clear(); renderLibrary(); });
  $("mix-go").addEventListener("click", () => {
    const id = makeMix([...mixSel]);
    if (!id) return;
    mixMode = false; mixSel.clear(); renderLibrary();
    openSet(id);
  });
  $("view-library").addEventListener("click", (e) => {
    const mp = e.target.closest("[data-mixpick]");
    if (mp) {
      const id = mp.dataset.mixpick;
      if (mixSel.has(id)) mixSel.delete(id); else mixSel.add(id);
      renderLibrary();
      return;
    }
    const lib = e.target.closest("[data-lib]");
    const lang = e.target.closest("[data-pick-lang]");
    const level = e.target.closest("[data-pick-level]");
    const subj = e.target.closest("[data-pick-subject]");
    if (lib) pick.lib = lib.dataset.lib;
    else if (lang) { if (pick.lang !== lang.dataset.pickLang) { pick.lang = lang.dataset.pickLang; pick.level = 0; } }
    else if (level) pick.level = Number(level.dataset.pickLevel);
    else if (subj) pick.subject = subj.dataset.pickSubject;
    else return;
    savePick(); renderLibrary();
  });

  document.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) { saveCopy(add.dataset.add); return; }
    const open = e.target.closest("[data-open]");
    const cards = e.target.closest("[data-cards]");
    const quiz = e.target.closest("[data-quiz]");
    const write = e.target.closest("[data-write]");
    if (cards) startCards(cards.dataset.cards);
    else if (quiz) startQuiz(quiz.dataset.quiz);
    else if (write) startWrite(write.dataset.write);
    else if (open) openSet(open.dataset.open);
  });
  $("new-set").addEventListener("click", () => openEditor(null));
  $("empty-new").addEventListener("click", () => openEditor(null));
  $("empty-sample").addEventListener("click", () => {
    const now = Date.now();
    data.sets.unshift({
      id: uid(), pos: topPos(), created: now, title: "Spanish basics", lang: "es", lang2: "en", updated: now,
      cards: [
        ["hola", "hello"], ["gracias", "thank you"], ["por favor", "please"], ["adiós", "goodbye"],
        ["perro", "dog"], ["gato", "cat"], ["agua", "water"], ["libro", "book"],
      ].map(([term, def]) => ({ id: uid(), term, def })),
    });
    save(); render();
    toast("Added a sample set");
  });

  /* ---------- one set ---------- */
  let currentSet = null;
  function openSet(id) {
    if (!findSet(id)) return;
    currentSet = id;
    renderSet();
    openScreen("set-screen");
  }
  function renderSet() {
    const s = findSet(currentSet);
    if (!s) { if (!$("set-screen").hidden) closeScreen(); return; }
    $("set-title").textContent = s.title;
    $("set-edit").textContent = s.builtIn ? (addedCopy(s.id) ? "✓ In your sets" : "+ Add to my sets") : "Edit";
    $("set-edit").disabled = !!(s.builtIn && addedCopy(s.id));
    const langs = s.lang ? `${langName(s.lang)}${s.lang2 ? ` → ${langName(s.lang2)}` : ""} · ` : "";
    $("set-sub").textContent = langs + plural(s.cards.length, "card") + (s.best != null ? ` · best quiz score ${s.best}%` : "");
    // Which side to show first. Mandarin always shows the character, and you choose
    // whether to answer with the pinyin or the meaning.
    const zh = isZh(s);
    $("dir-seg").previousElementSibling.textContent = zh ? "Answer with" : "Show first";
    $("dir-term").textContent = zh ? "Pinyin" : langName(s.lang, "Term");
    $("dir-answer").textContent = zh ? "Meaning" : langName(s.lang2, "Answer");
    $("dir-term").setAttribute("aria-pressed", !s.flip);
    $("dir-answer").setAttribute("aria-pressed", !!s.flip);
    const tricky = s.shared ? [] : trickyIn(s);
    $("go-tricky").hidden = !tricky.length;
    $("go-tricky").innerHTML = `<span>🎯</span><span><strong>Practice your ${plural(tricky.length, "tricky word")}</strong><small>Get each one right twice to clear it</small></span><span class="chev">›</span>`;
    $("set-terms").innerHTML = s.cards.length
      ? s.cards.map((c) => `<li${isTricky(s, c) ? ' class="is-tricky"' : ""}><span class="t">${emojiFor(s, c) ? `<span class="emo" aria-hidden="true">${emojiFor(s, c)}</span>` : ""}${esc(c.term)}${zh && c.pin ? `<span class="pin">${esc(c.pin)}</span>` : ""}${isTricky(s, c) ? '<span class="tricky-tag">🎯 tricky</span>' : ""}</span><span class="d">${esc(c.def)}</span></li>`).join("")
      : `<li><span class="muted">No cards yet. Tap Edit to add some.</span></li>`;
  }
  $("dir-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dir]");
    const s = findSet(currentSet);
    if (!b || !s) return;
    s.flip = b.dataset.dir === "answer";
    s.updated = Date.now();
    save(); renderSet();
  });

  // What to show and what to answer for a card, depending on the set's direction.
  function sides(s, c) {
    if (isZh(s)) {
      const meaningFirst = !!s.flip || !c.pin;
      return {
        q: c.term, qLang: "zh", qLabel: "Mandarin",
        a: meaningFirst ? c.def : c.pin, aLang: meaningFirst ? s.lang2 : "", pinyin: !meaningFirst,
        aLabel: meaningFirst ? langName(s.lang2, "Meaning") : "Pinyin",
        back: [c.pin, c.def].filter(Boolean).join("\n"), backLabel: c.pin ? "Pinyin · meaning" : langName(s.lang2, "Meaning"),
        ask: meaningFirst ? "What does this mean?" : "Which pinyin is right?",
      };
    }
    const f = !!s.flip;
    const q = f ? c.def : c.term, a = f ? c.term : c.def;
    const qLang = f ? s.lang2 : s.lang, aLang = f ? s.lang : s.lang2;
    const qLabel = langName(qLang, f ? "Answer" : "Term"), aLabel = langName(aLang, f ? "Term" : "Answer");
    return { q, a, qLang, aLang, qLabel, aLabel, back: a, backLabel: aLabel, pinyin: false,
      ask: aLang && LANGS[aLang] && aLang !== qLang ? `What is it in ${LANGS[aLang].name}?` : qLang ? "What does this mean?" : "Pick the right answer" };
  }
  $("set-back").addEventListener("click", closeScreen);
  $("set-share").addEventListener("click", () => { const s = findSet(currentSet); if (s) shareSet(s); });
  $("set-edit").addEventListener("click", () => {
    const s = findSet(currentSet);
    if (s && s.builtIn) saveCopy(s.id); else openEditor(currentSet);
  });
  $("go-cards").addEventListener("click", () => startCards(currentSet));
  $("go-quiz").addEventListener("click", () => startQuiz(currentSet));
  $("go-write").addEventListener("click", () => startWrite(currentSet));

  /* ---------- making and changing a set ---------- */
  let editing = null; // set id, or null for a new set
  const EXAMPLES = { es: ["perro", "dog"], fr: ["le chien", "the dog"], la: ["canis", "dog"], zh: ["狗", "dog"] };
  function cardRow(c = { id: uid(), term: "", def: "", pin: "" }) {
    const lang = $("edit-lang").value, lang2 = $("edit-lang2").value;
    const zh = lang === "zh";
    const ex = EXAMPLES[lang] || ["mitochondria", "the powerhouse of the cell"];
    const li = document.createElement("li");
    li.className = "edit-card" + (zh ? " zh" : "");
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="edit-card-head"><button type="button" class="remove-card" aria-label="Remove this card">×</button></div>
      <div class="edit-card-fields">
        <label class="field"><span>${zh ? "Character" : esc(langName(lang, "Term"))}</span><textarea class="in-term" rows="1" maxlength="300" placeholder="e.g. ${esc(ex[0])}">${esc(c.term)}</textarea></label>
        ${zh ? `<label class="field"><span>Pinyin</span><textarea class="in-pin" rows="1" maxlength="300" placeholder="e.g. gǒu or gou3">${esc(c.pin || "")}</textarea></label>` : ""}
        <label class="field"><span>${zh ? "Meaning" : esc(langName(lang2, "Answer"))}</span><textarea class="in-def" rows="1" maxlength="600" placeholder="e.g. ${esc(ex[1])}">${esc(c.def)}</textarea></label>
      </div>`;
    return li;
  }
  const readRows = () => [...$("edit-cards").children].map((li) => ({
    id: li.dataset.id,
    term: li.querySelector(".in-term").value.trim(),
    pin: li.querySelector(".in-pin") ? numberedToMarks(li.querySelector(".in-pin").value.trim()) : "",
    def: li.querySelector(".in-def").value.trim(),
  }));
  function fillLangSelect(sel, value) {
    sel.innerHTML = Object.entries(LANGS).map(([code, l]) => `<option value="${code}">${l.name}</option>`).join("");
    sel.value = value || "";
  }
  // Changing a language relabels the cards (and adds or removes the Pinyin box), keeping what's typed.
  function relabelRows() {
    const keep = readRows().map((c) => {
      const old = [...$("edit-cards").children].find((li) => li.dataset.id === c.id);
      const pin = old && old.querySelector(".in-pin") ? old.querySelector(".in-pin").value.trim() : c.pin;
      return { ...c, pin };
    });
    const list = $("edit-cards");
    list.innerHTML = "";
    keep.forEach((c) => list.append(cardRow(c)));
    list.querySelectorAll("textarea").forEach(grow);
  }
  $("edit-lang").addEventListener("change", () => {
    if ($("edit-lang").value === "zh" && !$("edit-lang2").value) $("edit-lang2").value = "en";
    if ($("edit-lang").value && $("edit-lang").value !== "en" && !$("edit-lang2").value) $("edit-lang2").value = "en";
    relabelRows();
  });
  $("edit-lang2").addEventListener("change", relabelRows);

  // Accent buttons for the box being typed in: Spanish, French and Latin letters,
  // or pinyin tone marks for the Pinyin box.
  let typingIn = null;
  $("edit-cards").addEventListener("focusin", (e) => {
    const t = e.target;
    if (t.tagName !== "TEXTAREA") return;
    typingIn = t;
    const keys = t.classList.contains("in-pin") ? PINYIN_KEYS
      : (LANGS[t.classList.contains("in-term") ? $("edit-lang").value : $("edit-lang2").value] || {}).keys;
    fillKeys($("edit-accents"), keys);
  });
  $("edit-title").addEventListener("focus", () => { $("edit-accents").hidden = true; });
  $("edit-accents").addEventListener("mousedown", (e) => e.preventDefault()); // keep the typing box focused
  $("edit-accents").addEventListener("click", (e) => {
    const k = e.target.closest("[data-key]");
    if (k) typeInto(typingIn, k.dataset.key);
  });
  function grow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  function openEditor(id) {
    editing = id;
    const s = id ? findSet(id) : null;
    $("edit-heading").textContent = s ? "Edit set" : "New set";
    $("edit-title").value = s ? s.title : "";
    fillLangSelect($("edit-lang"), s ? s.lang : "");
    fillLangSelect($("edit-lang2"), s ? s.lang2 : "");
    $("edit-accents").hidden = true;
    $("paste-box").hidden = true;
    $("paste-open").hidden = false;
    $("edit-delete").hidden = !s;
    const list = $("edit-cards");
    list.innerHTML = "";
    const cards = s && s.cards.length ? s.cards : [undefined, undefined, undefined];
    cards.forEach((c) => list.append(cardRow(c)));
    openScreen("edit-screen");
    list.querySelectorAll("textarea").forEach(grow);
    setTimeout(() => $("edit-title").focus(), 50);
  }
  $("edit-cards").addEventListener("input", (e) => { if (e.target.tagName === "TEXTAREA") grow(e.target); });
  $("edit-cards").addEventListener("click", (e) => {
    const rm = e.target.closest(".remove-card");
    if (!rm) return;
    const list = $("edit-cards");
    rm.closest(".edit-card").remove();
    if (!list.children.length) list.append(cardRow());
  });
  // Enter in an answer box jumps to the next card (or adds one), so typing a list is quick.
  $("edit-cards").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || !e.target.classList.contains("in-def")) return;
    e.preventDefault();
    const next = e.target.closest(".edit-card").nextElementSibling;
    if (next) next.querySelector(".in-term").focus(); else addCard();
  });
  $("edit-cards").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && (e.target.classList.contains("in-term") || e.target.classList.contains("in-pin"))) {
      e.preventDefault();
      const card = e.target.closest(".edit-card");
      const pin = card.querySelector(".in-pin");
      (e.target.classList.contains("in-term") && pin ? pin : card.querySelector(".in-def")).focus();
    }
  });
  function addCard() {
    const row = cardRow();
    $("edit-cards").append(row);
    row.querySelector(".in-term").focus();
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  $("add-card").addEventListener("click", addCard);
  $("edit-cancel").addEventListener("click", closeScreen);

  /* ---------- paste a list ---------- */
  // Turns pasted lines like "perro - dog" into cards. The separator is whichever of
  // these most lines use: tab (spreadsheets, Quizlet), dash, =, colon, or comma.
  // Mandarin lines can have three parts: "狗 - gǒu - dog" or "狗 gǒu - dog".
  const SEPARATORS = ["\t", " — ", " – ", " - ", " = ", "=", " : ", ": ", ":", " -", "- ", ","];
  function parseList(text, zh) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];
    const main = SEPARATORS.find((s) => lines.filter((l) => l.includes(s)).length >= Math.ceil(lines.length / 2));
    return lines.map((line) => {
      // Use the list's main separator, or this line's own if it's written differently.
      const sep = main && line.includes(main) ? main : SEPARATORS.find((s) => line.includes(s));
      if (!sep) return null;
      const at = line.indexOf(sep);
      if (at < 0) return null;
      const term = line.slice(0, at).trim();
      let rest = line.slice(at + sep.length).trim();
      if (!term || !rest) return null;
      if (!zh) return { term, def: rest };
      // Mandarin: character, pinyin, meaning.
      const second = rest.indexOf(sep);
      if (second >= 0) return { term, pin: numberedToMarks(rest.slice(0, second).trim()), def: rest.slice(second + sep.length).trim() };
      const m = term.match(/^([\p{Script=Han}]+)\s+(.+)$/u);
      if (m) return { term: m[1], pin: numberedToMarks(m[2]), def: rest };
      return { term, def: rest };
    }).filter(Boolean);
  }
  function updatePaste() {
    const n = parseList($("paste-text").value, $("edit-lang").value === "zh").length;
    $("paste-add").disabled = !n;
    $("paste-add").textContent = n ? `Add ${plural(n, "card")}` : "Add cards";
  }
  $("paste-open").addEventListener("click", () => {
    $("paste-box").hidden = false;
    $("paste-open").hidden = true;
    $("paste-text").value = "";
    $("paste-hint").textContent = $("edit-lang").value === "zh"
      ? "One card per line: character, pinyin and meaning with a dash or tab between them, like 狗 - gou3 - dog."
      : "Put a dash, =, colon or tab between each word and its meaning. Lists copied from a spreadsheet or Quizlet work too.";
    updatePaste();
    $("paste-text").focus();
  });
  $("paste-text").addEventListener("input", updatePaste);
  function closePaste() { $("paste-box").hidden = true; $("paste-open").hidden = false; }

  /* ---------- add words from any set ---------- */
  // A picker for the set editor: browse your sets, the Languages library or SAT,
  // open a set, check the words you want (from as many sets as you like) and add them.
  const pk = { src: "mine", lang: "", level: 0, subject: "Vocabulary", set: null, sel: new Map() };
  const pickKey = (s, c) => `${s.id}|${c.id}`;
  function pickSets() {
    if (pk.src === "mine") return liveSets().filter((x) => x.id !== editing);
    if (pk.src === "sat") return SAT.filter((x) => (x.subject || "Vocabulary") === pk.subject);
    const course = COURSES.find((c) => c.lang === pk.lang) || COURSES[0];
    return course ? COURSE_SETS.filter((x) => x.course === course.lang && x.level === pk.level) : [];
  }
  function renderPick() {
    const s = pk.set && findSet(pk.set);
    $("pick-sources").hidden = !!s;
    $("pick-all").hidden = !s;
    $("pick-title").textContent = s ? (s.unit || s.title) : "Add words";
    document.querySelectorAll("[data-psrc]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.psrc === pk.src));
    if (!s) {
      const course = COURSES.find((c) => c.lang === pk.lang) || COURSES[0];
      $("pick-chips1").innerHTML = pk.src === "langs" ? COURSES.map((c) => chip("data-plang", c.lang, c === course, `${c.icon} ${esc(c.name)}`)).join("")
        : pk.src === "sat" ? SUBJECTS.map(([n]) => chip("data-psubj", n, n === pk.subject, esc(n))).join("") : "";
      $("pick-chips2").innerHTML = pk.src === "langs" && course ? course.levels.map((lv, i) => chip("data-plevel", i, i === pk.level, esc(levelLabel(lv.name, course.name)))).join("") : "";
      const sets = pickSets();
      $("pick-list").innerHTML = sets.length ? sets.map((x) => {
        const n = x.cards.filter((c) => pk.sel.has(pickKey(x, c))).length;
        return `<li class="lib-row"><button type="button" class="lib-open" data-pset="${x.id}">
          <span class="set-info"><span class="set-name">${esc(x.unit || x.title.replace(/^SAT (Math: )?/, ""))}</span>
          <span class="set-meta">${plural(x.cards.length, "word")}${n ? ` · ${n} picked` : ""}</span></span><span class="chev">›</span></button></li>`;
      }).join("") : `<li class="muted center">No sets here yet.</li>`;
    } else {
      const zh = isZh(s);
      $("pick-list").innerHTML = s.cards.map((c, i) => {
        const on = pk.sel.has(pickKey(s, c));
        return `<li class="lib-row mixing${on ? " checked" : ""}"><button type="button" class="lib-open" data-pcard="${i}" aria-pressed="${on}">
          <span class="check"><span></span></span>
          <span class="set-info"><span class="set-name">${esc(c.term)}${zh && c.pin ? ` <span class="pin-inline">${esc(c.pin)}</span>` : ""}</span><span class="set-meta">${esc(c.def)}</span></span></button></li>`;
      }).join("");
      $("pick-all").textContent = s.cards.every((c) => pk.sel.has(pickKey(s, c))) ? "Select none" : "Select all";
    }
    const n = pk.sel.size;
    $("pick-count").textContent = n ? `${plural(n, "word")} picked` : "Pick some words";
    $("pick-add").disabled = !n;
    $("pick-add").textContent = n ? `Add ${plural(n, "word")}` : "Add words";
  }
  $("pick-open").addEventListener("click", () => {
    pk.set = null; pk.sel = new Map();
    if (!pk.lang && COURSES[0]) pk.lang = $("edit-lang").value && COURSES.some((c) => c.lang === $("edit-lang").value) ? $("edit-lang").value : COURSES[0].lang;
    renderPick();
    openScreen("pick-screen");
  });
  $("pick-back").addEventListener("click", () => {
    if (pk.set) { pk.set = null; renderPick(); } else closeScreen();
  });
  $("pick-all").addEventListener("click", () => {
    const s = findSet(pk.set);
    if (!s) return;
    const all = s.cards.every((c) => pk.sel.has(pickKey(s, c)));
    s.cards.forEach((c) => { if (all) pk.sel.delete(pickKey(s, c)); else pk.sel.set(pickKey(s, c), { ...c, _from: s }); });
    renderPick();
  });
  $("pick-screen").addEventListener("click", (e) => {
    const src = e.target.closest("[data-psrc]"), pl = e.target.closest("[data-plang]"), lv = e.target.closest("[data-plevel]");
    const sj = e.target.closest("[data-psubj]"), ps = e.target.closest("[data-pset]"), pc = e.target.closest("[data-pcard]");
    if (src) pk.src = src.dataset.psrc;
    else if (pl) { if (pk.lang !== pl.dataset.plang) { pk.lang = pl.dataset.plang; pk.level = 0; } }
    else if (lv) pk.level = Number(lv.dataset.plevel);
    else if (sj) pk.subject = sj.dataset.psubj;
    else if (ps) { pk.set = ps.dataset.pset; $("pick-screen").scrollTop = 0; }
    else if (pc) {
      const s = findSet(pk.set), c = s && s.cards[Number(pc.dataset.pcard)];
      if (!c) return;
      const k = pickKey(s, c);
      if (pk.sel.has(k)) pk.sel.delete(k); else pk.sel.set(k, { ...c, _from: s });
    } else return;
    renderPick();
  });
  $("pick-add").addEventListener("click", () => {
    const picked = [...pk.sel.values()];
    if (!picked.length) return;
    // A set with no language yet takes the language of the words being added.
    const first = picked[0]._from;
    if (!$("edit-lang").value && first.lang) {
      $("edit-lang").value = first.lang;
      $("edit-lang2").value = first.lang2 || (first.lang !== "en" ? "en" : "");
      relabelRows();
    }
    const list = $("edit-cards");
    [...list.children].forEach((li) => { if (![...li.querySelectorAll("textarea")].some((t) => t.value.trim())) li.remove(); });
    picked.forEach((c) => list.append(cardRow({ id: uid(), term: c.term, def: c.def, pin: c.pin || "" })));
    list.querySelectorAll("textarea").forEach(grow);
    closeScreen();
    toast(`Added ${plural(picked.length, "word")}`);
  });
  $("paste-cancel").addEventListener("click", closePaste);
  $("paste-add").addEventListener("click", () => {
    const cards = parseList($("paste-text").value, $("edit-lang").value === "zh");
    if (!cards.length) return;
    const list = $("edit-cards");
    // Empty cards are replaced by the pasted ones; cards already typed stay.
    [...list.children].forEach((li) => { if (![...li.querySelectorAll("textarea")].some((t) => t.value.trim())) li.remove(); });
    cards.forEach((c) => list.append(cardRow({ id: uid(), ...c })));
    list.querySelectorAll("textarea").forEach(grow);
    closePaste();
    toast(`Added ${plural(cards.length, "card")}`);
  });
  $("edit-form").addEventListener("submit", (e) => { e.preventDefault(); saveEditor(); });
  $("edit-save").addEventListener("click", saveEditor);
  function saveEditor() {
    const title = $("edit-title").value.trim();
    if (!title) { $("edit-title").focus(); toast("Give your set a name"); return; }
    const lang = $("edit-lang").value, lang2 = $("edit-lang2").value;
    const cards = readRows().filter((c) => c.term || c.def || c.pin).map((c) => {
      if (lang !== "zh" || !c.pin) { const { pin, ...rest } = c; return rest; }
      return c;
    });
    const now = Date.now();
    let s = editing ? findSet(editing) : null;
    if (s) Object.assign(s, { title, cards, lang, lang2, updated: now });
    else { s = { id: uid(), pos: topPos(), created: now, title, cards, lang, lang2, updated: now }; data.sets.unshift(s); }
    save(); render();
    closeScreen();
    if (!editing) openSet(s.id);
    toast("Saved");
  }
  $("edit-delete").addEventListener("click", async () => {
    const s = findSet(editing);
    if (!s || !(await askConfirm(`Delete "${s.title}"? This can't be undone.`, "Delete"))) return;
    data.sets = data.sets.map((x) => (x.id === s.id ? { id: s.id, deleted: true, updated: Date.now() } : x));
    save(); render();
    closeAll();
    toast("Set deleted");
  });

  /* ---------- small emojis for vocab words ---------- */
  // Looks up the card's English meaning in emoji.js ("dog" → 🐶). Only the first
  // choice is used, without "to", "a" or "the", and only exact matches count.
  const EMOJI = window.EMOJI || {};
  const emojiKey = (text) => text.split(/[,;/]/)[0].toLowerCase().replace(/[.!?¡¿]/g, "").replace(/^(to|a|an|the)\s+/, "").trim();
  function emojiFor(s, c) {
    if (!s || !c) return "";
    const english = s.lang2 === "en" || (!s.lang2 && !s.lang) ? c.def : s.lang === "en" && s.lang2 ? c.term : "";
    return english ? EMOJI[emojiKey(english)] || "" : "";
  }

  /* ---------- tricky words ---------- */
  // Missing a card makes it "tricky"; getting it right twice in a row clears it.
  const TRICKY = "tricky";
  const statKey = (s, c) => `${c._set || s.id}|${c.id}`; // cards in a mixed set count toward their own set
  const statOf = (s, c) => (s && c && data.stats ? data.stats[statKey(s, c)] || null : null);
  function setStat(s, c, st) {
    if (!s || !c) return;
    data.stats = data.stats || {};
    if (st) data.stats[statKey(s, c)] = st; else delete data.stats[statKey(s, c)];
  }
  function track(s, c, ok) {
    if (!s || !c || (s.shared && !c._set)) return;
    const st = { m: 0, s: 0, ...statOf(s, c), t: Date.now() };
    if (ok) { st.s += 1; if (st.s >= 2) st.m = 0; } else { st.m += 1; st.s = 0; }
    if (!st.m && !statOf(s, c)) return; // right on a card never missed: nothing to remember
    setStat(s, c, st);
    save();
  }
  const isTricky = (s, c) => { const st = statOf(s, c); return !!(st && st.m > 0); };
  const trickyIn = (s) => (s ? usable(s).filter((c) => isTricky(s, c)) : []);
  // Every tricky card from all your sets and the Library, most-missed first.
  function trickyCards() {
    const out = [];
    for (const [k, st] of Object.entries(data.stats || {})) {
      if (!st.m) continue;
      const [setId, cardId] = k.split("|");
      const s = findSet(setId);
      const c = s && usable(s).find((x) => x.id === cardId);
      if (c) out.push({ ...c, _set: s.id, _m: st.m, _t: st.t });
    }
    return out.sort((a, b) => b._m - a._m || b._t - a._t).slice(0, 40);
  }
  $("review-tricky").addEventListener("click", () => startCards(TRICKY, shuffle(trickyCards())));
  $("go-tricky").addEventListener("click", () => { const s = findSet(currentSet); startCards(currentSet, shuffle(trickyIn(s))); });

  /* ---------- flashcards ---------- */
  let deck = [], pos = 0, missed = [], got = 0, deckSet = null;
  const usable = (s) => s.cards.filter((c) => c.term && (c.def || (isZh(s) && c.pin)));
  // id "tricky" is a mixed deck of your tricky cards from every set; each card
  // then carries its own set id in _set.
  const cardSet = (c) => findSet((c && c._set) || deckSet);
  function startCards(id, only) {
    const s = id === TRICKY ? null : findSet(id);
    if (!s && id !== TRICKY) return;
    const cards = only || (s ? usable(s) : trickyCards());
    if (!cards.length) { toast(s ? "Add some cards with an answer first" : "No tricky words right now 🎉"); return; }
    deckSet = id; deck = [...cards]; pos = 0; missed = []; got = 0;
    if (s) s.studied = Date.now();
    save(); render();
    $("cards-play").hidden = false; $("cards-result").hidden = true;
    showCard();
    openScreen("cards-screen");
  }
  function showCard() {
    const c = deck[pos];
    const sd = sides(cardSet(c), c);
    // Turn the card back to its front instantly (no flip animation), so the next
    // card's answer is never seen while it turns.
    const fc = $("flashcard");
    fc.classList.add("instant");
    fc.classList.remove("flipped");
    void fc.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => fc.classList.remove("instant")));
    $("fc-front").textContent = sd.q;
    $("fc-back").textContent = sd.back;
    $("fc-front-label").textContent = sd.qLabel;
    $("fc-back-label").textContent = sd.backLabel;
    $("fc-emoji").textContent = emojiFor(cardSet(c), c); // on the answer side, so it never gives the answer away
    const [sayFront, sayBack] = document.querySelectorAll("#flashcard .say");
    sayFront.hidden = !canSpeak(sd.qLang);
    sayBack.hidden = !canSpeak(isZh(cardSet(c)) ? "zh" : sd.aLang);
    $("cards-progress").textContent = `${pos + 1} of ${deck.length}`;
    $("cards-bar").style.width = `${(pos / deck.length) * 100}%`;
  }
  function judge(knew) {
    if (knew) got++; else missed.push(deck[pos]);
    track(cardSet(deck[pos]), deck[pos], knew);
    countCard();
    pos++;
    if (pos < deck.length) { showCard(); return; }
    $("cards-bar").style.width = "100%";
    $("cards-progress").textContent = "Done!";
    $("cards-play").hidden = true; $("cards-result").hidden = false;
    $("cards-emoji").textContent = missed.length ? "💪" : "🎉";
    $("cards-score").textContent = `You knew ${got} of ${deck.length}`;
    const left = deckSet === TRICKY ? trickyCards().length : 0;
    $("cards-msg").textContent = missed.length ? `${plural(missed.length, "card")} to keep practicing.`
      : deckSet === TRICKY ? (left ? `Get each one right twice to clear it. ${plural(left, "tricky word")} left.` : "You cleared every tricky word! 🎉")
      : "You knew every card. Nice work!";
    $("cards-missed").hidden = !missed.length;
  }
  $("flashcard").addEventListener("click", (e) => {
    const say = e.target.closest(".say");
    if (say) {
      // The speaker button reads that side out loud instead of flipping the card.
      const c = deck[pos], s = cardSet(c), sd = sides(s, c);
      if (say.dataset.say === "front") speak(sd.q, sd.qLang);
      else if (isZh(s)) speak(c.term, "zh");
      else speak(sd.a, sd.aLang);
      return;
    }
    $("flashcard").classList.toggle("flipped");
  });
  $("flashcard").addEventListener("keydown", (e) => {
    if (e.target.closest(".say") && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); e.target.click(); }
  });
  $("fc-got").addEventListener("click", () => judge(true));
  $("fc-miss").addEventListener("click", () => judge(false));
  $("cards-shuffle").addEventListener("click", () => { deck = [...deck.slice(0, pos), ...shuffle(deck.slice(pos))]; showCard(); toast("Shuffled"); });
  $("cards-missed").addEventListener("click", () => { closeScreen(); startCards(deckSet, shuffle(missed)); });
  $("cards-again").addEventListener("click", () => { closeScreen(); startCards(deckSet); });
  $("cards-back").addEventListener("click", closeScreen);
  document.addEventListener("keydown", (e) => {
    if ($("cards-screen").hidden || !$("cards-result").hidden || !$("dialog").hidden) return;
    if (e.key === " ") { e.preventDefault(); $("flashcard").click(); }
    if (e.key === "ArrowRight") judge(true);
    if (e.key === "ArrowLeft") judge(false);
  });

  /* ---------- quiz ---------- */
  let quiz = [], qpos = 0, right = 0, quizSet = null;
  function startQuiz(id) {
    const s = findSet(id);
    if (!s) return;
    const cards = usable(s).filter((c) => sides(s, c).a);
    if (cards.length < 2) { toast("A quiz needs at least 2 cards with answers"); return; }
    quizSet = id; quiz = shuffle(cards); qpos = 0; right = 0;
    s.studied = Date.now(); save(); render();
    $("quiz-play").hidden = false; $("quiz-result").hidden = true;
    showQuestion();
    openScreen("quiz-screen");
  }
  function showQuestion() {
    const c = quiz[qpos];
    const s = findSet(quizSet);
    const sd = sides(s, c);
    // The right answer plus up to 3 others from the same set.
    const others = shuffle([...new Set(usable(s).map((x) => sides(s, x).a).filter((d) => d && d !== sd.a))]).slice(0, 3);
    const choices = shuffle([sd.a, ...others]);
    $("quiz-term").textContent = sd.q;
    $("quiz-label").textContent = sd.ask;
    document.querySelector('[data-say="quiz"]').hidden = !canSpeak(sd.qLang);
    $("quiz-progress").textContent = `${qpos + 1} of ${quiz.length}`;
    $("quiz-bar").style.width = `${(qpos / quiz.length) * 100}%`;
    $("quiz-next").hidden = true;
    $("quiz-choices").innerHTML = choices.map((d) => `<button type="button" class="choice">${esc(d)}</button>`).join("");
    [...$("quiz-choices").children].forEach((b, i) => { b.dataset.right = choices[i] === sd.a ? "1" : ""; });
  }
  document.querySelector('[data-say="quiz"]').addEventListener("click", () => {
    const sd = sides(findSet(quizSet), quiz[qpos]);
    speak(sd.q, sd.qLang);
  });
  $("quiz-choices").addEventListener("click", (e) => {
    const b = e.target.closest(".choice");
    if (!b || b.disabled) return;
    const buttons = [...$("quiz-choices").children];
    buttons.forEach((x) => { x.disabled = true; if (x.dataset.right) x.classList.add("right"); });
    if (b.dataset.right) right++; else b.classList.add("wrong");
    track(findSet(quizSet), quiz[qpos], !!b.dataset.right);
    countCard();
    $("quiz-next").textContent = qpos + 1 < quiz.length ? "Next" : "See my score";
    $("quiz-next").hidden = false;
    $("quiz-next").focus();
  });
  $("quiz-next").addEventListener("click", () => {
    qpos++;
    if (qpos < quiz.length) { showQuestion(); return; }
    const pct = Math.round((right / quiz.length) * 100);
    const s = findSet(quizSet);
    if (s && (s.best == null || pct > s.best)) { s.best = pct; s.updated = Date.now(); save(); render(); }
    $("quiz-bar").style.width = "100%";
    $("quiz-progress").textContent = "Done!";
    $("quiz-play").hidden = true; $("quiz-result").hidden = false;
    $("quiz-emoji").textContent = pct === 100 ? "🏆" : pct >= 70 ? "🎉" : "💪";
    $("quiz-score").textContent = `${right} of ${quiz.length} right (${pct}%)`;
    $("quiz-msg").textContent = pct === 100 ? "A perfect score!" : pct >= 70 ? "Great job. Keep it up!" : "Try the flashcards, then take it again.";
  });
  $("quiz-again").addEventListener("click", () => { closeScreen(); startQuiz(quizSet); });
  $("quiz-cards").addEventListener("click", () => { closeScreen(); startCards(quizSet); });
  $("quiz-back").addEventListener("click", closeScreen);

  /* ---------- write: type the answer ---------- */
  let wlist = [], wpos = 0, wright = 0, wmissed = [], writeSet = null, checked = false, lastWrong = false, beforeTrack = null;
  function startWrite(id, only) {
    const s = findSet(id);
    if (!s) return;
    const cards = only || usable(s).filter((c) => sides(s, c).a);
    if (!cards.length) { toast("Add some cards with an answer first"); return; }
    writeSet = id; wlist = shuffle(cards); wpos = 0; wright = 0; wmissed = [];
    s.studied = Date.now(); save(); render();
    $("write-play").hidden = false; $("write-result").hidden = true;
    showWrite();
    openScreen("write-screen");
    setTimeout(() => $("write-input").focus(), 80);
  }
  function showWrite() {
    const s = findSet(writeSet), c = wlist[wpos], sd = sides(s, c);
    checked = false; lastWrong = false;
    $("write-term").textContent = sd.q;
    $("write-label").textContent = sd.pinyin ? "Type the pinyin" : `Type the ${sd.aLabel === "Answer" ? "answer" : sd.aLabel}`;
    $("write-input").value = "";
    $("write-input").disabled = false;
    $("write-input").placeholder = sd.pinyin ? "Tone marks or numbers: ni3 hao3" : "Type your answer";
    $("write-feedback").hidden = true;
    $("write-override").hidden = true;
    $("write-check").textContent = "Check";
    $("write-progress").textContent = `${wpos + 1} of ${wlist.length}`;
    $("write-bar").style.width = `${(wpos / wlist.length) * 100}%`;
    document.querySelector('[data-say="write"]').hidden = !canSpeak(sd.qLang);
    fillKeys($("write-accents"), sd.pinyin ? PINYIN_KEYS : (LANGS[sd.aLang] || {}).keys);
  }
  function feedback(kind, html) {
    const f = $("write-feedback");
    f.className = "write-feedback " + kind;
    f.innerHTML = html;
    f.hidden = false;
  }
  $("write-play").addEventListener("submit", (e) => {
    e.preventDefault();
    if (checked) { nextWrite(); return; }
    const s = findSet(writeSet), c = wlist[wpos], sd = sides(s, c);
    const typed = $("write-input").value;
    if (!typed.trim()) { $("write-input").focus(); return; }
    const result = checkAnswer(typed, sd.a, sd.pinyin);
    beforeTrack = statOf(s, c);
    track(s, c, result !== "wrong");
    countCard();
    checked = true;
    $("write-input").disabled = true;
    if (result === "right") { wright++; feedback("good", "✓ Correct!"); }
    else if (result === "accents") {
      wright++;
      feedback("close", `Almost! Watch the ${sd.pinyin ? "tones" : "accents"}: <strong>${esc(sd.a)}</strong>`);
    } else {
      lastWrong = true;
      wmissed.push(c);
      feedback("bad", `The answer is <strong>${esc(sd.a)}</strong>`);
      $("write-override").hidden = false;
    }
    if (sd.pinyin || canSpeak(sd.aLang)) speak(isZh(s) ? c.term : sd.a, isZh(s) ? "zh" : sd.aLang);
    $("write-check").textContent = wpos + 1 < wlist.length ? "Next" : "See my score";
    $("write-check").focus();
  });
  // For typos: count a wrong answer as right.
  $("write-override").addEventListener("click", () => {
    if (!lastWrong) return;
    lastWrong = false;
    wright++;
    wmissed.pop();
    // Undo the miss that was just recorded, and count it as right instead.
    const s = findSet(writeSet), c = wlist[wpos];
    setStat(s, c, beforeTrack);
    track(s, c, true);
    save();
    $("write-override").hidden = true;
    feedback("good", "✓ Counted as right");
    $("write-check").focus();
  });
  function nextWrite() {
    wpos++;
    if (wpos < wlist.length) { showWrite(); $("write-input").focus(); return; }
    const pct = Math.round((wright / wlist.length) * 100);
    $("write-bar").style.width = "100%";
    $("write-progress").textContent = "Done!";
    $("write-play").hidden = true; $("write-result").hidden = false;
    $("write-emoji").textContent = pct === 100 ? "🏆" : pct >= 70 ? "🎉" : "💪";
    $("write-score").textContent = `${wright} of ${wlist.length} right (${pct}%)`;
    $("write-msg").textContent = wmissed.length ? `${plural(wmissed.length, "card")} to practice again.` : "You wrote every one right!";
    $("write-missed").hidden = !wmissed.length;
  }
  $("write-accents").addEventListener("mousedown", (e) => e.preventDefault());
  $("write-accents").addEventListener("click", (e) => {
    const k = e.target.closest("[data-key]");
    if (k && !$("write-input").disabled) typeInto($("write-input"), k.dataset.key);
  });
  document.querySelector('[data-say="write"]').addEventListener("click", () => {
    const sd = sides(findSet(writeSet), wlist[wpos]);
    speak(sd.q, sd.qLang);
  });
  $("write-missed").addEventListener("click", () => { closeScreen(); startWrite(writeSet, wmissed); });
  $("write-again").addEventListener("click", () => { closeScreen(); startWrite(writeSet); });
  $("write-back").addEventListener("click", closeScreen);

  /* ---------- Profile: settings ---------- */
  function applySettings() {
    const st = data.settings;
    const c = COLORS[st.color] || COLORS.blue;
    const root = document.documentElement;
    root.classList.toggle("dark", !!st.dark);
    root.style.setProperty("--bg", st.dark ? "#16151a" : "#f5f5f5");
    root.style.setProperty("--pastel", c.pastel);
    root.style.setProperty("--accent", st.dark ? c.pastel : c.accent);
    root.style.setProperty("--on-accent", st.dark ? "#16151a" : "#ffffff");
    document.querySelector('meta[name="theme-color"]').content = st.dark ? "#16151a" : "#f5f5f5";
    $("dark-toggle").checked = !!st.dark;
    if (document.activeElement !== $("name-input")) $("name-input").value = st.name || "";
    $("swatches").innerHTML = Object.entries(COLORS).map(([name, v]) =>
      `<button type="button" class="swatch" role="radio" aria-label="${name}" aria-checked="${name === st.color}" data-color="${name}" style="background:${v.pastel}"></button>`).join("");
  }
  $("swatches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-color]");
    if (!b) return;
    data.settings.color = b.dataset.color;
    applySettings(); settingsChanged();
  });
  $("dark-toggle").addEventListener("change", (e) => { data.settings.dark = e.target.checked; applySettings(); settingsChanged(); });
  $("name-input").addEventListener("change", (e) => { data.settings.name = e.target.value.trim(); settingsChanged(); });

  /* ---------- daily streak ---------- */
  // Study 10 cards in a day (flashcards, quiz answers or written answers) to keep
  // your streak. Reaching the goal sets off a burst of dots; new badges get a bigger one.
  const GOAL = 10;
  const BADGES = [[3, "✨", "Spark"], [7, "🔥", "On fire"], [14, "☄️", "Blazing"], [30, "🚀", "Unstoppable"], [50, "🏆", "Legend"], [100, "💯", "Centurion"], [365, "👑", "Year-long legend"]];
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daysAgo = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const cardsOn = (n) => (data.days || {})[dayKey(daysAgo(n))] || 0;
  // Days in a row with the goal met, counting today only once it's met.
  function streakDays() {
    let n = 0;
    for (let i = cardsOn(0) >= GOAL ? 0 : 1; cardsOn(i) >= GOAL; i++) n++;
    return n;
  }
  const badgeFor = (n) => [...BADGES].reverse().find(([days]) => n >= days);
  let justMet = false; // today's goal was reached a moment ago, so today's dot pops in
  function renderStreak() {
    const today = Math.min(cardsOn(0), GOAL);
    const streak = streakDays();
    const fill = $("ring-fill");
    const len = 2 * Math.PI * 19;
    fill.style.strokeDasharray = len;
    fill.style.strokeDashoffset = len * (1 - today / GOAL);
    $("ring").classList.toggle("done", today >= GOAL);
    $("ring").classList.toggle("just", justMet);
    $("ring-num").textContent = today >= GOAL ? "✓" : `${today}/${GOAL}`;
    $("ring").setAttribute("aria-label", `${today} of ${GOAL} cards studied today`);
    $("streak-count").textContent = streak ? `🔥 ${streak}-day streak` : "Start a streak";
    const badge = badgeFor(streak);
    $("streak-badge").hidden = !badge;
    if (badge) $("streak-badge").textContent = `${badge[1]} ${badge[2]}`;
    const left = GOAL - today;
    const next = BADGES.find(([days]) => days > streak);
    $("streak-msg").textContent =
      today >= GOAL ? (next && next[0] - streak <= 3 ? `Done for today 🎉 ${next[0] - streak} more ${next[0] - streak === 1 ? "day" : "days"} to unlock ${next[1]} ${next[2]}!` : "Done for today 🎉 See you tomorrow!")
      : streak ? `${left} more ${left === 1 ? "card" : "cards"} to keep your ${streak}-day streak going!`
      : today ? `${left} more ${left === 1 ? "card" : "cards"} to start your streak!`
      : `Study ${GOAL} cards today to start a streak.`;
    $("week").innerHTML = [6, 5, 4, 3, 2, 1, 0].map((n) => {
      const c = cardsOn(n), d = daysAgo(n);
      const cls = c >= GOAL ? "met" : c ? "some" : "";
      return `<span class="wday ${cls}${n === 0 ? " today" : ""}${n === 0 && justMet ? " new" : ""}" title="${d.toLocaleDateString(undefined, { weekday: "long" })}: ${plural(c, "card")}"><i></i>${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>`;
    }).join("");
  }
  // Called each time a card is answered while studying.
  function countCard() {
    const k = dayKey(new Date());
    data.days = data.days || {};
    const before = data.days[k] || 0;
    data.days[k] = before + 1;
    save();
    renderStreak();
    if (before + 1 === GOAL) {
      justMet = true; renderStreak(); justMet = false;
      const streak = streakDays();
      const badge = BADGES.find(([days]) => days === streak);
      if (badge) celebrate(`${badge[1]} New badge: ${badge[2]}!`, `${streak} days in a row. Amazing!`, 70);
      else if (streak === 1) celebrate("🔥 Streak started!", "Come back tomorrow for day 2.", 36);
      else celebrate(`🔥 Day ${streak}!`, CHEERS[streak % CHEERS.length], 40);
    }
  }
  const CHEERS = ["Keep it going!", "You're on a roll!", "Nice work today!", "Your brain thanks you.", "Look at you go!", "Another day, another dot."];
  // A burst of colorful dots from the middle of the screen, with a cheer.
  function celebrate(title, text, count) {
    const layer = document.createElement("div");
    layer.className = "burst";
    layer.setAttribute("aria-live", "polite");
    const colors = ["#7fb2f0", "#f4a3bd", "#a6dcb5", "#f7d070", "#c9b3f2", "#f8b38a"];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots = "";
    for (let i = 0; i < (reduce ? 0 : count); i++) {
      const angle = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 180;
      dots += `<span class="bdot" style="--x:${Math.cos(angle) * dist}px;--y:${Math.sin(angle) * dist - 60}px;--s:${0.6 + Math.random() * 0.9};background:${colors[i % colors.length]};animation-delay:${Math.random() * 120}ms"></span>`;
    }
    layer.innerHTML = `${dots}<div class="cheer"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
    document.body.append(layer);
    setTimeout(() => layer.remove(), 2600);
  }

  /* ---------- start ---------- */
  loadLocal();
  ensurePos();
  applySettings();
  render();

  /* ---------- works offline, installs like an app ---------- */
  // The offline worker (sw.js) keeps a copy of Studydot on the device. On this computer
  // (localhost) it's off unless the address has ?offline, so changes show up right away.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || new URLSearchParams(location.search).has("offline"))) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("offline", () => toast("You're offline. Studydot still works."));
  // "Get the app" in Profile: an Install button where the browser offers one
  // (Android, Chrome and Edge on computers), or Add to Home Screen steps on iPhone/iPad.
  const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let installPrompt = null;
  function showGetApp() {
    const canPrompt = !!installPrompt;
    $("get-app").hidden = installed() || !(canPrompt || isIOS);
    $("install-btn").hidden = !canPrompt;
    $("ios-steps").hidden = canPrompt || !isIOS;
  }
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; showGetApp(); });
  $("install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    showGetApp();
  });
  window.addEventListener("appinstalled", () => { installPrompt = null; showGetApp(); toast("Studydot is installed 🎉"); });
  showGetApp();

  showTab();
  openLink(); // opened from a share link?
  setTimeout(() => { $("splash").remove(); }, 2400);
})();
