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
  let data = { sets: [], settings: { color: "blue", dark: false, name: "" } };

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
      if (saved && Array.isArray(saved.sets)) data = { sets: saved.sets, settings: { ...data.settings, ...saved.settings }, settingsUpdated: saved.settingsUpdated || 0 };
    } catch { /* nothing saved yet */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
    if (window.studydotSync) window.studydotSync.queue();
  }
  const liveSets = () => data.sets.filter((s) => !s.deleted);
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
    const copy = { id: uid(), from: src.id, title: src.title, lang: src.lang, lang2: src.lang2, updated: Date.now(),
      cards: src.cards.map((c) => ({ id: uid(), term: c.term, def: c.def, ...(c.pin ? { pin: c.pin } : {}) })) };
    data.sets.unshift(copy);
    save(); render();
    toast(`Added "${src.title}" to your sets`);
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
      };
    },
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    load(next) {
      data = { sets: next.sets || [], settings: { ...data.settings, ...next.settings }, settingsUpdated: next.settingsUpdated || 0 };
      try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignore */ }
      applySettings(); render();
    },
    clearLocal() {
      data = { sets: [], settings: { color: "blue", dark: false, name: "" } };
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
  }
  function closeAll() { while (stack.length) closeScreen(); }
  window.openOverlay = openScreen;
  window.closeOverlay = closeScreen;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("dialog").hidden) { $("dialog-no").click(); return; }
    if (e.key === "Escape" && stack.length) closeScreen();
  });

  /* ---------- tabs ---------- */
  const TABS = ["sets", "study", "langs", "sat", "profile"];
  function showTab() {
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "sets";
    closeAll();
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== tab; });
    document.querySelectorAll(".tab").forEach((t) => {
      if (t.dataset.tab === tab) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", showTab);

  /* ---------- Sets tab ---------- */
  function render() {
    const sets = liveSets();
    $("sets-count").textContent = sets.length ? plural(sets.length, "set") : "";
    $("sets-empty").hidden = sets.length > 0;
    $("new-set").hidden = sets.length === 0;
    $("sets-list").innerHTML = sets.map((s) => `
      <li><button type="button" class="set-row" data-open="${s.id}">
        <span class="set-badge">${esc((s.title.trim()[0] || "?").toLowerCase())}</span>
        <span class="set-info"><span class="set-name">${esc(s.title)}</span>
          <span class="set-meta">${s.lang && s.lang !== "en" ? `${langName(s.lang)} · ` : ""}${plural(s.cards.length, "card")}${s.studied ? ` · studied ${ago(s.studied)}` : ""}</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </button></li>`).join("");

    // Study tab: most recently studied first.
    const recent = [...sets].sort((a, b) => (b.studied || b.updated || 0) - (a.studied || a.updated || 0));
    $("study-empty").hidden = recent.length > 0;
    $("study-list").innerHTML = recent.map((s) => `
      <li class="study-row">
        <span class="set-badge">${esc((s.title.trim()[0] || "?").toLowerCase())}</span>
        <span class="set-info" data-open="${s.id}"><span class="set-name">${esc(s.title)}</span>
          <span class="set-meta">${plural(s.cards.length, "card")}${s.best != null ? ` · best quiz ${s.best}%` : ""}</span></span>
        <span class="study-btns">
          <button type="button" data-cards="${s.id}">🃏 Cards</button>
          <button type="button" data-quiz="${s.id}">✅ Quiz</button>
          <button type="button" data-write="${s.id}">✍️ Write</button>
        </span>
      </li>`).join("");
    // SAT tab: the ready-made sets.
    $("sat-list").innerHTML = SAT.map((s) => `
      <li class="study-row">
        <span class="set-badge">${s.id === "sat-math" ? "∑" : "A"}</span>
        <span class="set-info" data-open="${s.id}"><span class="set-name">${esc(s.title)}</span>
          <span class="set-meta">${esc(s.blurb)} · ${plural(s.cards.length, "card")}</span></span>
        <span class="study-btns">
          <button type="button" data-cards="${s.id}">🃏 Cards</button>
          <button type="button" data-quiz="${s.id}">✅ Quiz</button>
          <button type="button" data-write="${s.id}">✍️ Write</button>
        </span>
      </li>`).join("");
    renderLangs();
    if (currentSet && !$("set-screen").hidden) renderSet();
  }

  /* ---------- Languages tab: language → level → units ---------- */
  const PICK_KEY = "studydot:langpick";
  let pick = { lang: "", level: 0 };
  try { pick = { ...pick, ...JSON.parse(localStorage.getItem(PICK_KEY)) }; } catch { /* first visit */ }
  function renderLangs() {
    $("lang-pick").innerHTML = COURSES.map((c) => `
      <button type="button" class="lang-btn" role="radio" aria-checked="${c.lang === pick.lang}" data-pick-lang="${c.lang}">
        <span class="lang-icon">${c.icon}</span><span>${esc(c.name)}</span>
      </button>`).join("");
    const course = COURSES.find((c) => c.lang === pick.lang);
    $("level-card").hidden = !course;
    if (!course) return;
    if (!course.levels[pick.level]) pick.level = 0;
    $("level-pick").innerHTML = course.levels.map((lv, i) => `
      <button type="button" class="level-btn" role="radio" aria-checked="${i === pick.level}" data-pick-level="${i}">${esc(/\d$/.test(lv.name) ? "Level " + lv.name.slice(-1) : lv.name)}</button>`).join("");
    const units = COURSE_SETS.filter((s) => s.course === course.lang && s.level === pick.level);
    $("unit-list").innerHTML = units.map((s, i) => {
      const added = addedCopy(s.id);
      return `
      <li class="study-row unit-row">
        <span class="set-badge">${i + 1}</span>
        <span class="set-info" data-open="${s.id}"><span class="set-name">${esc(s.unit)}</span>
          <span class="set-meta">${plural(s.cards.length, "word")}</span></span>
        <button type="button" class="add-unit ${added ? "added" : "primary"}" data-add="${s.id}" ${added ? "disabled" : ""}>${added ? "✓ Added" : "+ Add"}</button>
        <span class="study-btns">
          <button type="button" data-cards="${s.id}">🃏 Cards</button>
          <button type="button" data-quiz="${s.id}">✅ Quiz</button>
          <button type="button" data-write="${s.id}">✍️ Write</button>
        </span>
      </li>`;
    }).join("");
  }
  const savePick = () => { try { localStorage.setItem(PICK_KEY, JSON.stringify(pick)); } catch { /* ignore */ } };
  $("lang-pick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick-lang]");
    if (!b) return;
    if (pick.lang !== b.dataset.pickLang) pick = { lang: b.dataset.pickLang, level: 0 };
    savePick(); renderLangs();
    $("level-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("level-pick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick-level]");
    if (!b) return;
    pick.level = Number(b.dataset.pickLevel);
    savePick(); renderLangs();
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
  $("study-make").addEventListener("click", () => { location.hash = "#sets"; openEditor(null); });
  $("empty-sample").addEventListener("click", () => {
    const now = Date.now();
    data.sets.unshift({
      id: uid(), title: "Spanish basics", lang: "es", lang2: "en", updated: now,
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
    $("set-terms").innerHTML = s.cards.length
      ? s.cards.map((c) => `<li><span class="t">${esc(c.term)}${zh && c.pin ? `<span class="pin">${esc(c.pin)}</span>` : ""}</span><span class="d">${esc(c.def)}</span></li>`).join("")
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
    else { s = { id: uid(), title, cards, lang, lang2, updated: now }; data.sets.unshift(s); }
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

  /* ---------- flashcards ---------- */
  let deck = [], pos = 0, missed = [], got = 0, deckSet = null;
  const usable = (s) => s.cards.filter((c) => c.term && (c.def || (isZh(s) && c.pin)));
  function startCards(id, only) {
    const s = findSet(id);
    if (!s) return;
    const cards = only || usable(s);
    if (!cards.length) { toast("Add some cards with an answer first"); return; }
    deckSet = id; deck = [...cards]; pos = 0; missed = []; got = 0;
    s.studied = Date.now(); save(); render();
    $("cards-play").hidden = false; $("cards-result").hidden = true;
    showCard();
    openScreen("cards-screen");
  }
  function showCard() {
    const c = deck[pos];
    const sd = sides(findSet(deckSet), c);
    $("flashcard").classList.remove("flipped");
    $("fc-front").textContent = sd.q;
    $("fc-back").textContent = sd.back;
    $("fc-front-label").textContent = sd.qLabel;
    $("fc-back-label").textContent = sd.backLabel;
    const [sayFront, sayBack] = document.querySelectorAll("#flashcard .say");
    sayFront.hidden = !canSpeak(sd.qLang);
    sayBack.hidden = !canSpeak(isZh(findSet(deckSet)) ? "zh" : sd.aLang);
    $("cards-progress").textContent = `${pos + 1} of ${deck.length}`;
    $("cards-bar").style.width = `${(pos / deck.length) * 100}%`;
  }
  function judge(knew) {
    if (knew) got++; else missed.push(deck[pos]);
    pos++;
    if (pos < deck.length) { showCard(); return; }
    $("cards-bar").style.width = "100%";
    $("cards-progress").textContent = "Done!";
    $("cards-play").hidden = true; $("cards-result").hidden = false;
    $("cards-emoji").textContent = missed.length ? "💪" : "🎉";
    $("cards-score").textContent = `You knew ${got} of ${deck.length}`;
    $("cards-msg").textContent = missed.length ? `${plural(missed.length, "card")} to keep practicing.` : "You knew every card. Nice work!";
    $("cards-missed").hidden = !missed.length;
  }
  $("flashcard").addEventListener("click", (e) => {
    const say = e.target.closest(".say");
    if (say) {
      // The speaker button reads that side out loud instead of flipping the card.
      const s = findSet(deckSet), c = deck[pos], sd = sides(s, c);
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
  let wlist = [], wpos = 0, wright = 0, wmissed = [], writeSet = null, checked = false, lastWrong = false;
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

  /* ---------- start ---------- */
  loadLocal();
  applySettings();
  render();
  showTab();
  setTimeout(() => { $("splash").remove(); }, 2400);
})();
