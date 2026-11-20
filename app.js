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
  const findSet = (id) => data.sets.find((s) => s.id === id && !s.deleted);

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
  const TABS = ["sets", "study", "profile"];
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
          <span class="set-meta">${plural(s.cards.length, "card")}${s.studied ? ` · studied ${ago(s.studied)}` : ""}</span></span>
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
        </span>
      </li>`).join("");
    if (currentSet && !$("set-screen").hidden) renderSet();
  }
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    const cards = e.target.closest("[data-cards]");
    const quiz = e.target.closest("[data-quiz]");
    if (cards) startCards(cards.dataset.cards);
    else if (quiz) startQuiz(quiz.dataset.quiz);
    else if (open) openSet(open.dataset.open);
  });
  $("new-set").addEventListener("click", () => openEditor(null));
  $("empty-new").addEventListener("click", () => openEditor(null));
  $("study-make").addEventListener("click", () => { location.hash = "#sets"; openEditor(null); });
  $("empty-sample").addEventListener("click", () => {
    const now = Date.now();
    data.sets.unshift({
      id: uid(), title: "Spanish basics", updated: now,
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
    $("set-sub").textContent = plural(s.cards.length, "card") + (s.best != null ? ` · best quiz score ${s.best}%` : "");
    $("set-terms").innerHTML = s.cards.length
      ? s.cards.map((c) => `<li><span class="t">${esc(c.term)}</span><span class="d">${esc(c.def)}</span></li>`).join("")
      : `<li><span class="muted">No cards yet. Tap Edit to add some.</span></li>`;
  }
  $("set-back").addEventListener("click", closeScreen);
  $("set-edit").addEventListener("click", () => openEditor(currentSet));
  $("go-cards").addEventListener("click", () => startCards(currentSet));
  $("go-quiz").addEventListener("click", () => startQuiz(currentSet));

  /* ---------- making and changing a set ---------- */
  let editing = null; // set id, or null for a new set
  function cardRow(c = { id: uid(), term: "", def: "" }) {
    const li = document.createElement("li");
    li.className = "edit-card";
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="edit-card-head"><button type="button" class="remove-card" aria-label="Remove this card">×</button></div>
      <div class="edit-card-fields">
        <label class="field"><span>Term</span><textarea class="in-term" rows="1" maxlength="300" placeholder="e.g. perro">${esc(c.term)}</textarea></label>
        <label class="field"><span>Answer</span><textarea class="in-def" rows="1" maxlength="600" placeholder="e.g. dog">${esc(c.def)}</textarea></label>
      </div>`;
    return li;
  }
  function grow(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }
  function openEditor(id) {
    editing = id;
    const s = id ? findSet(id) : null;
    $("edit-heading").textContent = s ? "Edit set" : "New set";
    $("edit-title").value = s ? s.title : "";
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
    if (e.key === "Enter" && !e.shiftKey && e.target.classList.contains("in-term")) {
      e.preventDefault();
      e.target.closest(".edit-card").querySelector(".in-def").focus();
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
    const cards = [...$("edit-cards").children].map((li) => ({
      id: li.dataset.id,
      term: li.querySelector(".in-term").value.trim(),
      def: li.querySelector(".in-def").value.trim(),
    })).filter((c) => c.term || c.def);
    const now = Date.now();
    let s = editing ? findSet(editing) : null;
    if (s) Object.assign(s, { title, cards, updated: now });
    else { s = { id: uid(), title, cards, updated: now }; data.sets.unshift(s); }
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
  const usable = (s) => s.cards.filter((c) => c.term && c.def);
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
    $("flashcard").classList.remove("flipped");
    $("fc-front").textContent = c.term;
    $("fc-back").textContent = c.def;
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
  $("flashcard").addEventListener("click", () => $("flashcard").classList.toggle("flipped"));
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
    const cards = usable(s);
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
    // The right answer plus up to 3 others from the same set.
    const others = shuffle([...new Set(usable(s).map((x) => x.def).filter((d) => d !== c.def))]).slice(0, 3);
    const choices = shuffle([c.def, ...others]);
    $("quiz-term").textContent = c.term;
    $("quiz-progress").textContent = `${qpos + 1} of ${quiz.length}`;
    $("quiz-bar").style.width = `${(qpos / quiz.length) * 100}%`;
    $("quiz-next").hidden = true;
    $("quiz-choices").innerHTML = choices.map((d) => `<button type="button" class="choice">${esc(d)}</button>`).join("");
    [...$("quiz-choices").children].forEach((b, i) => { b.dataset.right = choices[i] === c.def ? "1" : ""; });
  }
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
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
