// Studydot accounts: email + password sign-in with Firebase, and saving your sets
// to the account so they show up on every device. Works the same way as Daydot's.
// If this can't connect (offline), Studydot still works and saves in the browser.

// Public web settings for the Studydot Firebase project (safe to publish; the
// database rules in firestore.rules are what keep each person's sets private).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBhFDjcv28upPdWxN9fy-aZtcO1ogXBynA",
  authDomain: "studydot-app.firebaseapp.com",
  projectId: "studydot-app",
  storageBucket: "studydot-app.firebasestorage.app",
  messagingSenderId: "194586324785",
  appId: "1:194586324785:web:d2ec3f38091968103fca10",
};

const $ = (id) => document.getElementById(id);
const FB = "https://www.gstatic.com/firebasejs/10.14.1/";

if (FIREBASE_CONFIG) start().catch(() => {
  $("acct-off-note").textContent = "Couldn't connect to accounts. Your sets are still saved on this device.";
});

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.initializeAuth(app, { persistence: [A.indexedDBLocalPersistence, A.browserLocalPersistence] });
  const db = F.getFirestore(app);

  // The last email used on this device, so logging in again is quick (never the password).
  const EMAIL_KEY = "studydot:email";
  const rememberedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ""; } catch { return ""; } };
  const rememberEmail = (e) => { try { if (e) localStorage.setItem(EMAIL_KEY, e); else localStorage.removeItem(EMAIL_KEY); } catch { /* ignore */ } };

  let user = null, ready = false, dirty = false, rev = 0, loading = false, timer = null, unsubscribe = null, mode = "login";
  const userDoc = () => F.doc(db, "users", user.uid);
  const setStatus = (t) => { $("sync-status").textContent = t; };
  const OFFLINE = "Offline · saved on this device, will sync when you're back online";

  async function upload() {
    clearTimeout(timer);
    if (!user || !ready) return false;
    const startRev = rev;
    try {
      await F.setDoc(userDoc(), { ...window.studydot.snapshot(), updatedAt: F.serverTimestamp() });
      if (rev === startRev) { dirty = false; setStatus("✓ Saved to your account"); }
      return true;
    } catch {
      setStatus(navigator.onLine ? "Couldn't save. Trying again soon…" : OFFLINE);
      timer = setTimeout(upload, 15000);
      return false;
    }
  }

  window.studydotSync = {
    queue() {
      if (!user) return;
      dirty = true; rev++;
      if (!ready) return;
      setStatus(navigator.onLine ? "Saving…" : OFFLINE);
      clearTimeout(timer);
      timer = setTimeout(upload, 800);
    },
  };

  function combine(cloud) {
    const local = window.studydot.snapshot();
    const merged = window.studydot.merge(cloud, local);
    if (!window.studydot.same(merged, local)) window.studydot.load(merged);
    return !window.studydot.same(merged, cloud);
  }

  function showLoggedOut() {
    const email = rememberedEmail();
    $("acct-off").hidden = true;
    $("acct-in").hidden = true;
    $("acct-back").hidden = !email;
    $("acct-out").hidden = !!email;
    $("acct-remembered").textContent = email;
    $("storage-note").hidden = false;
  }

  A.onAuthStateChanged(auth, (u) => {
    user = u; ready = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!u) { showLoggedOut(); return; }
    $("acct-off").hidden = $("acct-out").hidden = $("acct-back").hidden = true;
    $("acct-in").hidden = false;
    $("storage-note").hidden = true;
    $("acct-email").textContent = u.email;
    rememberEmail(u.email);
    loadAccount(u);
  });

  async function loadAccount(u) {
    if (user !== u || ready || loading) return;
    loading = true;
    setStatus("Loading your sets…");
    try {
      const snap = await F.getDoc(userDoc());
      if (user !== u) return;
      if (snap.exists()) combine(snap.data());
      ready = true;
      await upload();
      // Changes made on another device are combined in as they arrive.
      unsubscribe = F.onSnapshot(userDoc(), (s) => {
        if (!s.exists() || s.metadata.hasPendingWrites) return;
        if (combine(s.data())) window.studydotSync.queue();
      });
    } catch {
      setStatus(navigator.onLine ? "Couldn't reach your account. Your sets are still saved on this device." : OFFLINE);
      window.addEventListener("online", () => loadAccount(u), { once: true });
      setTimeout(() => loadAccount(u), 20000);
    } finally {
      loading = false;
    }
  }
  window.addEventListener("online", () => { if (dirty) upload(); });

  /* ---------- log in / create account screen ---------- */
  function setMode(m) {
    mode = m;
    const signup = m === "signup";
    $("acct-title").textContent = signup ? "Create account" : "Log in";
    $("acct-submit").textContent = signup ? "Create account" : "Log in";
    $("acct-password").autocomplete = signup ? "new-password" : "current-password";
    $("acct-forgot").hidden = signup;
    document.querySelectorAll("[data-acct-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.acctMode === m));
    showError(""); showNote("");
  }
  function showError(t) { $("acct-error").textContent = t; $("acct-error").hidden = !t; }
  function showNote(t) { $("acct-note").textContent = t; $("acct-note").hidden = !t; }
  function openAccount(m) {
    setMode(m);
    const email = m === "login" ? rememberedEmail() : "";
    $("acct-email-input").value = email;
    $("acct-password").value = "";
    window.openOverlay("account-screen");
    setTimeout(() => $(email ? "acct-password" : "acct-email-input").focus(), 50);
  }
  const MESSAGES = {
    "auth/email-already-in-use": "There's already an account with that email. Try logging in.",
    "auth/invalid-email": "That doesn't look like an email address.",
    "auth/weak-password": "Pick a password with at least 6 characters.",
    "auth/invalid-credential": "That email and password don't match. Try again.",
    "auth/wrong-password": "That email and password don't match. Try again.",
    "auth/user-not-found": "There's no account with that email. Create one instead.",
    "auth/too-many-requests": "Too many tries. Wait a minute and try again.",
    "auth/network-request-failed": "Couldn't connect. Check your internet and try again.",
  };
  const messageFor = (e) => MESSAGES[e && e.code] || "Something went wrong. Try again.";

  $("acct-signup").addEventListener("click", () => openAccount("signup"));
  $("acct-login").addEventListener("click", () => openAccount("login"));
  $("acct-quick").addEventListener("click", () => openAccount("login"));
  $("acct-forget").addEventListener("click", () => { rememberEmail(""); showLoggedOut(); });
  $("acct-cancel").addEventListener("click", () => window.closeOverlay());
  document.querySelectorAll("[data-acct-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.acctMode)));

  $("acct-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("acct-email-input").value.trim();
    const password = $("acct-password").value;
    showError(""); showNote("");
    if (!email) return showError("Type your email first.");
    if (password.length < 6) return showError(mode === "signup" ? MESSAGES["auth/weak-password"] : "Type your password.");
    $("acct-submit").disabled = true;
    try {
      if (mode === "signup") await A.createUserWithEmailAndPassword(auth, email, password);
      else await A.signInWithEmailAndPassword(auth, email, password);
      rememberEmail(email);
      window.closeOverlay();
    } catch (err) {
      showError(messageFor(err));
    } finally {
      $("acct-submit").disabled = false;
    }
  });

  $("acct-forgot").addEventListener("click", async () => {
    const email = $("acct-email-input").value.trim();
    showError(""); showNote("");
    if (!email) return showError("Type your email above, then tap Forgot password again.");
    try {
      await A.sendPasswordResetEmail(auth, email);
      showNote("If there's an account for that email, we sent it a link to reset your password.");
    } catch (err) { showError(messageFor(err)); }
  });

  $("acct-logout").addEventListener("click", async () => {
    if (!(await window.askConfirm("Log out? Your sets stay saved in your account, and are removed from this device until you log in again.", "Log out"))) return;
    if (dirty) {
      const ok = ready && (await Promise.race([upload(), new Promise((r) => setTimeout(() => r(false), 8000))]));
      if ((!ok || dirty) && !(await window.askConfirm("Some changes haven't reached your account yet (you might be offline). If you log out now, they'll be lost. Log out anyway?", "Log out anyway"))) return;
    }
    await A.signOut(auth);
    window.studydot.clearLocal();
  });
}
