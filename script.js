/* ==========================================================================
   Just Us: a private photo space for two
   ========================================================================== */

/* ---------- Settings you can change ---------- */

// The code that opens the site (digits only).
const PASSCODE = "2918";

// Shared syncing through your Firebase project, so both of you see the same
// photos, likes and responses on any device. To use a different project, paste
// its "const firebaseConfig = { ... };" block over this one (leave out the
// "import" lines Firebase shows above it). If the values are ever emptied, the
// site falls back to saving photos only in the browser you are using.
const firebaseConfig = {
  apiKey: "AIzaSyC_CGsShlbzppR1QADBxYgoBA1_MJTw_UA",
  authDomain: "justus-df5c2.firebaseapp.com",
  projectId: "justus-df5c2",
  storageBucket: "justus-df5c2.firebasestorage.app",
  messagingSenderId: "513920839947",
  appId: "1:513920839947:web:8aafac41b6a75939f3320e",
};

/* ---------- Constants ---------- */

const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/12.3.0/";
const IMAGE_MAX_EDGE = 1800; // longest side of a stored photo, in pixels
const IMAGE_MAX_CHARS = 850000; // keeps each photo safely under Firestore's 1 MB document limit
const UPLOAD_PATIENCE_MS = 25000;

const KEYS = {
  unlocked: "justus:unlocked",
  name: "justus:name",
  view: "justus:view",
  noticeDismissed: "justus:notice-dismissed",
};

const AVATAR_TONES = [
  ["#f1d4d6", "#9b5a62"],
  ["#ddd6ee", "#655890"],
  ["#d6e5d8", "#4d7257"],
  ["#f3e0cb", "#8f633b"],
  ["#d5e3ec", "#4a6a80"],
];

/* ---------- Small helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const storage = {
  get(key, area = localStorage) {
    try {
      return area.getItem(key);
    } catch (_) {
      return null;
    }
  },
  set(key, value, area = localStorage) {
    try {
      area.setItem(key, value);
    } catch (_) {
      /* storage can be unavailable in private browsing */
    }
  },
  remove(key, area = localStorage) {
    try {
      area.removeItem(key);
    } catch (_) {
      /* ignore */
    }
  },
};

function session() {
  try {
    return window.sessionStorage;
  } catch (_) {
    return null; // null (not undefined) so the helpers above don't fall back to localStorage
  }
}

function uid() {
  if (window.crypto && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function cleanName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

function initialOf(name) {
  const first = Array.from(String(name || "").trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}

function paintAvatar(node, name) {
  let hash = 0;
  for (const char of String(name || "").toLowerCase()) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  const [bg, fg] = AVATAR_TONES[hash % AVATAR_TONES.length];
  node.style.setProperty("--avatar-bg", bg);
  node.style.setProperty("--avatar-fg", fg);
  node.textContent = initialOf(name);
  node.setAttribute("aria-hidden", "true");
}

function timeAgo(ms) {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 50) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const date = new Date(ms);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" });
}

function fullDate(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function paintTime(node, ms) {
  node.dataset.ts = String(ms);
  node.dateTime = new Date(ms).toISOString();
  node.title = fullDate(ms);
  node.textContent = timeAgo(ms);
}

function greetingFor(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

function clampRatio(width, height, min = 0.8, max = 1.78) {
  const ratio = width > 0 && height > 0 ? width / height : 0.8;
  return Math.min(max, Math.max(min, ratio));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error("Timed out"), { code: "timeout" })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function friendlyError(error, fallback = "Something went wrong. Please try again.") {
  const code = error && error.code;
  if (code === "permission-denied") {
    return "The shared space said no. Check that the Firestore rules from the guide are published.";
  }
  if (code === "resource-exhausted") return "The free daily limit of the shared space was reached. Try again tomorrow.";
  if (code === "unavailable") return "Can’t reach the shared space right now. Check your connection.";
  if (code === "not-found") return "That memory no longer exists.";
  return fallback;
}

/* ---------- Preparing photos ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(Object.assign(new Error("Unreadable image"), { code: "unreadable" }));
    };
    img.src = url;
  });
}

function drawScaled(img, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // transparent PNGs get a clean background instead of black
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function prepareImage(file) {
  const { img, url } = await loadImage(file);
  try {
    if (!img.naturalWidth || !img.naturalHeight) {
      throw Object.assign(new Error("Empty image"), { code: "unreadable" });
    }
    let edge = Math.min(IMAGE_MAX_EDGE, Math.max(img.naturalWidth, img.naturalHeight));
    for (;;) {
      const canvas = drawScaled(img, edge);
      for (const quality of [0.86, 0.78, 0.7, 0.62]) {
        const blob = await canvasToBlob(canvas, quality);
        if (!blob) throw Object.assign(new Error("Could not encode"), { code: "unreadable" });
        if (Math.ceil(blob.size / 3) * 4 + 32 <= IMAGE_MAX_CHARS) {
          const thumb = drawScaled(img, 28).toDataURL("image/jpeg", 0.6);
          return { image: await blobToDataUrl(blob), thumb, width: canvas.width, height: canvas.height };
        }
      }
      if (edge <= 600) throw Object.assign(new Error("Too large"), { code: "too-large" });
      edge = Math.round(edge * 0.8);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const mime = (dataUrl.slice(0, comma).match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function normalizePost(id, data) {
  const comments = Array.isArray(data.comments)
    ? data.comments.filter((c) => c && typeof c.text === "string" && c.id)
    : [];
  comments.sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
  return {
    id,
    author: cleanName(data.author) || "Someone",
    caption: typeof data.caption === "string" ? data.caption : "",
    thumb: typeof data.thumb === "string" && /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(data.thumb) ? data.thumb : "",
    width: Number(data.width) || 4,
    height: Number(data.height) || 5,
    createdAt: Number(data.createdAt) || 0,
    likes: Array.isArray(data.likes) ? [...new Set(data.likes.filter((n) => typeof n === "string"))] : [],
    comments,
  };
}

/* ---------- Storage: this device only (IndexedDB) ---------- */

class LocalStore {
  constructor() {
    this.mode = "local";
    this.listeners = new Set();
    this.channel = "BroadcastChannel" in window ? new BroadcastChannel("just-us") : null;
  }

  async init() {
    if (!window.indexedDB) {
      throw Object.assign(new Error("No IndexedDB"), { code: "no-storage" });
    }
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("just-us", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("posts", { keyPath: "id" });
        request.result.createObjectStore("photos", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (this.channel) this.channel.onmessage = () => this.emit();
  }

  run(storeNames, mode, work) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeNames, mode);
      const request = work(tx);
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }

  async all() {
    const rows = await this.run("posts", "readonly", (tx) => tx.objectStore("posts").getAll());
    return rows.map((row) => normalizePost(row.id, row)).sort((a, b) => b.createdAt - a.createdAt);
  }

  subscribe(onChange, onError) {
    this.listeners.add(onChange);
    this.all().then((posts) => onChange(posts, { confirmed: true }), onError);
    return () => this.listeners.delete(onChange);
  }

  async emit() {
    const posts = await this.all();
    this.listeners.forEach((listener) => listener(posts, { confirmed: true }));
  }

  async changed() {
    await this.emit();
    if (this.channel) this.channel.postMessage("changed");
  }

  async addPost({ id, author, caption, image, thumb, width, height }) {
    const post = { id, author, caption, thumb, width, height, createdAt: Date.now(), likes: [], comments: [] };
    await this.run(["posts", "photos"], "readwrite", (tx) => {
      tx.objectStore("photos").put({ id, data: image });
      tx.objectStore("posts").put(post);
    });
    await this.changed();
  }

  async getPhoto(id) {
    const row = await this.run("photos", "readonly", (tx) => tx.objectStore("photos").get(id));
    if (!row) throw Object.assign(new Error("Photo missing"), { code: "not-found" });
    return dataUrlToBlob(row.data);
  }

  async update(id, change) {
    await this.run("posts", "readwrite", (tx) => {
      const posts = tx.objectStore("posts");
      const request = posts.get(id);
      request.onsuccess = () => {
        if (!request.result) return;
        const post = request.result;
        post.likes = post.likes || [];
        post.comments = post.comments || [];
        change(post);
        posts.put(post);
      };
    });
    await this.changed();
  }

  setLike(id, name, liked) {
    return this.update(id, (post) => {
      post.likes = post.likes.filter((n) => n !== name);
      if (liked) post.likes.push(name);
    });
  }

  addComment(id, comment) {
    return this.update(id, (post) => post.comments.push(comment));
  }

  deleteComment(id, comment) {
    return this.update(id, (post) => {
      post.comments = post.comments.filter((c) => c.id !== comment.id);
    });
  }

  updateCaption(id, caption) {
    return this.update(id, (post) => {
      post.caption = caption;
    });
  }

  async deletePost(id) {
    await this.run(["posts", "photos"], "readwrite", (tx) => {
      tx.objectStore("posts").delete(id);
      tx.objectStore("photos").delete(id);
    });
    await this.changed();
  }
}

/* ---------- Storage: shared between devices (Firebase Firestore) ---------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(Object.assign(new Error(`Could not load ${src}`), { code: "sdk-unavailable" }));
    };
    document.head.appendChild(script);
  });
}

// Photos never change once shared, so each device keeps its own copy and downloads a photo only once.
// Everything here is best effort: if the browser refuses, photos simply load from the database.
const photoCache = {
  name: "just-us-photos-v1",
  limit: 400,

  open() {
    if (!this.ready) {
      this.ready = withTimeout(window.caches.open(this.name), 3000);
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  },

  key(id) {
    return new URL(`photo-cache/${encodeURIComponent(id)}`, window.location.href).href;
  },

  async get(id) {
    try {
      const cache = await this.open();
      const hit = await withTimeout(cache.match(this.key(id)), 3000);
      return hit ? await hit.blob() : null;
    } catch (_) {
      return null;
    }
  },

  async put(id, blob) {
    try {
      const cache = await this.open();
      const response = new Response(blob, { headers: { "Content-Type": blob.type || "image/jpeg" } });
      await withTimeout(cache.put(this.key(id), response), 5000);
    } catch (_) {
      /* storage full or not allowed */
    }
  },

  // Forget deleted photos, and the oldest ones once there are more than `limit`
  async tidy(ids) {
    try {
      const cache = await this.open();
      const keep = new Set(ids.map((id) => this.key(id)));
      const requests = await cache.keys();
      const kept = requests.filter((request) => keep.has(request.url));
      const overflow = kept.slice(0, Math.max(0, kept.length - this.limit));
      const stale = requests.filter((request) => !keep.has(request.url));
      await Promise.all([...stale, ...overflow].map((request) => cache.delete(request)));
    } catch (_) {
      /* nothing to tidy */
    }
  },
};

let cloudConnections = 0;

class CloudStore {
  constructor(config) {
    this.mode = "cloud";
    this.config = config;
  }

  async init() {
    if (!window.firebase) await loadScript(`${FIREBASE_SDK}firebase-app-compat.js`);
    if (!window.firebase.firestore) await loadScript(`${FIREBASE_SDK}firebase-firestore-compat.js`);
    if (typeof window.firebase.firestore !== "function") {
      throw Object.assign(new Error("Firebase did not start"), { code: "sdk-unavailable" });
    }
    // Every connection gets its own Firebase app, so reconnecting never reuses a client that broke.
    // Firestore's offline cache (IndexedDB persistence) is deliberately left off: it is unreliable
    // in iPhone home-screen apps and can stop the whole connection. Photos are cached separately.
    cloudConnections += 1;
    this.app = firebase.initializeApp(this.config, `just-us-${cloudConnections}`);
    this.db = firebase.firestore(this.app);
    this.FieldValue = firebase.firestore.FieldValue;
    this.posts = this.db.collection("posts");
    this.photos = this.db.collection("photos");
  }

  dispose() {
    if (this.app) this.app.delete().catch(() => {});
  }

  subscribe(onChange, onError) {
    return this.posts.orderBy("createdAt", "desc").onSnapshot({ includeMetadataChanges: true }, (snapshot) => {
      const posts = snapshot.docs.map((doc) => normalizePost(doc.id, doc.data()));
      onChange(posts.sort((a, b) => b.createdAt - a.createdAt), { confirmed: !snapshot.metadata.fromCache });
    }, onError);
  }

  async addPost({ id, author, caption, image, thumb, width, height }) {
    await photoCache.put(id, dataUrlToBlob(image)); // no need to download your own photo again
    const batch = this.db.batch();
    batch.set(this.photos.doc(id), { data: image });
    batch.set(this.posts.doc(id), { author, caption, thumb, width, height, createdAt: Date.now(), likes: [], comments: [] });
    await batch.commit();
  }

  async getPhoto(id) {
    const cached = await photoCache.get(id);
    if (cached) return cached;
    const snapshot = await this.photos.doc(id).get();
    if (!snapshot.exists) throw Object.assign(new Error("Photo missing"), { code: "not-found" });
    const blob = dataUrlToBlob(snapshot.data().data);
    photoCache.put(id, blob);
    return blob;
  }

  setLike(id, name, liked) {
    const { arrayUnion, arrayRemove } = this.FieldValue;
    return this.posts.doc(id).update({ likes: liked ? arrayUnion(name) : arrayRemove(name) });
  }

  addComment(id, comment) {
    return this.posts.doc(id).update({ comments: this.FieldValue.arrayUnion(comment) });
  }

  deleteComment(id, comment) {
    return this.posts.doc(id).update({ comments: this.FieldValue.arrayRemove(comment) });
  }

  updateCaption(id, caption) {
    return this.posts.doc(id).update({ caption });
  }

  async deletePost(id) {
    const batch = this.db.batch();
    batch.delete(this.posts.doc(id));
    batch.delete(this.photos.doc(id));
    await batch.commit();
  }
}

/* ---------- App state ---------- */

const el = {
  lock: $("#lock"),
  lockCard: $("#lockCard"),
  lockHint: $("#lockHint"),
  lockStatus: $("#lockStatus"),
  pinDots: $("#pinDots"),
  keypad: $("#keypad"),
  welcome: $("#welcome"),
  welcomeEyebrow: $("#welcomeEyebrow"),
  welcomeTitle: $("#welcomeTitle"),
  welcomeText: $("#welcomeText"),
  nameForm: $("#nameForm"),
  nameInput: $("#nameInput"),
  app: $("#app"),
  topbar: $("#topbar"),
  meBtn: $("#meBtn"),
  meAvatar: $("#meAvatar"),
  meMenu: $("#meMenu"),
  meMenuAvatar: $("#meMenuAvatar"),
  meName: $("#meName"),
  syncStatus: $("#syncStatus"),
  renameBtn: $("#renameBtn"),
  lockBtn: $("#lockBtn"),
  content: $("#content"),
  greeting: $("#greeting"),
  stats: $("#stats"),
  viewSwitch: $("#viewSwitch"),
  setupNotice: $("#setupNotice"),
  noticeGuideBtn: $("#noticeGuideBtn"),
  noticeDismiss: $("#noticeDismiss"),
  loading: $("#loading"),
  feedError: $("#feedError"),
  feedErrorText: $("#feedErrorText"),
  feedErrorDetail: $("#feedErrorDetail"),
  retryBtn: $("#retryBtn"),
  errorGuideBtn: $("#errorGuideBtn"),
  empty: $("#empty"),
  emptyAddBtn: $("#emptyAddBtn"),
  feed: $("#feed"),
  gallery: $("#gallery"),
  feedEnd: $("#feedEnd"),
  fab: $("#newPostBtn"),
  postMenu: $("#postMenu"),
  composer: $("#composer"),
  composerForm: $("#composerForm"),
  dropzone: $("#dropzone"),
  fileInput: $("#fileInput"),
  previewImg: $("#previewImg"),
  changePhoto: $("#changePhoto"),
  captionInput: $("#captionInput"),
  captionCount: $("#captionCount"),
  shareBtn: $("#shareBtn"),
  viewer: $("#viewer"),
  viewerMedia: $("#viewerMedia"),
  viewerBlur: $("#viewerBlur"),
  viewerImg: $("#viewerImg"),
  viewerPrev: $("#viewerPrev"),
  viewerNext: $("#viewerNext"),
  viewerSide: $("#viewerSide"),
  confirmDialog: $("#confirmDialog"),
  confirmTitle: $("#confirmTitle"),
  confirmText: $("#confirmText"),
  confirmOk: $("#confirmOk"),
  editor: $("#editor"),
  editorTitle: $("#editorTitle"),
  editorForm: $("#editorForm"),
  editorInput: $("#editorInput"),
  guide: $("#guide"),
  rulesCode: $("#rulesCode"),
  copyRules: $("#copyRules"),
  toasts: $("#toasts"),
  postTemplate: $("#postTemplate"),
};

const state = {
  store: null,
  posts: [],
  byId: new Map(),
  me: cleanName(storage.get(KEYS.name)),
  view: storage.get(KEYS.view) === "gallery" ? "gallery" : "feed",
  started: false,
  loaded: false,
  unsubscribe: null,
  connection: 0, // increases with every connection attempt; answers from older attempts are ignored
  failures: 0,
  reconnecting: false,
  slowTimer: 0,
  retryTimer: 0,
  tidyTimer: 0,
  expanded: new Set(),
  openCaptions: new Set(),
  viewerId: null,
  viewerCard: null,
  menuAnchor: null,
  editingId: null,
};

const cards = new Map(); // post id -> feed card
const tiles = new Map(); // post id -> gallery tile
const photoUrls = new Map(); // post id -> Promise<object URL>

/* ---------- Dialogs, menus and toasts ---------- */

function openDialog(dialog) {
  if (dialog.open) {
    if (dialog._closing) {
      clearTimeout(dialog._closeTimer);
      dialog._closing = false;
      dialog.classList.add("is-open");
    }
    return;
  }
  dialog.classList.remove("is-open");
  dialog.showModal();
  document.documentElement.classList.add("has-modal");
  requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add("is-open")));
}

function closeDialog(dialog) {
  if (!dialog.open || dialog._closing) return;
  dialog._closing = true;
  dialog.classList.remove("is-open");
  if (el.postMenu.parentElement === dialog) hideMenu(el.postMenu);
  dialog._closeTimer = setTimeout(() => {
    if (dialog.open) dialog.close();
  }, 340);
}

function setupDialogs() {
  $$("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target.closest("[data-close]")) closeDialog(dialog);
    });
    dialog.addEventListener("close", () => {
      clearTimeout(dialog._closeTimer);
      dialog._closing = false;
      dialog.classList.remove("is-open");
      if (el.toasts.parentElement === dialog) topLayerHost().appendChild(el.toasts);
      if (el.postMenu.parentElement === dialog) {
        el.postMenu.hidden = true;
        document.body.appendChild(el.postMenu);
      }
      if (!$("dialog[open]")) document.documentElement.classList.remove("has-modal");
    });
  });
}

function topLayerHost() {
  const open = $$("dialog[open]").filter((dialog) => !dialog._closing);
  return open.length ? open[open.length - 1] : document.body;
}

function showMenu(menu) {
  menu._token = (menu._token || 0) + 1;
  menu.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add("is-open")));
}

function hideMenu(menu) {
  if (menu.hidden) return;
  menu.classList.remove("is-open");
  const token = (menu._token = (menu._token || 0) + 1);
  setTimeout(() => {
    if (menu._token === token) menu.hidden = true;
  }, 220);
}

function closeMenus() {
  hideMenu(el.postMenu);
  hideMenu(el.meMenu);
  el.meBtn.setAttribute("aria-expanded", "false");
  if (state.menuAnchor) {
    state.menuAnchor.setAttribute("aria-expanded", "false");
    state.menuAnchor = null;
  }
}

function toast(message, tone = "success") {
  const host = topLayerHost();
  if (el.toasts.parentElement !== host) host.appendChild(el.toasts);
  const node = document.createElement("div");
  node.className = `toast toast--${tone}`;
  node.setAttribute("role", tone === "error" ? "alert" : "status");
  const icon = { error: "alert", love: "heart", info: "cloud" }[tone] || "check";
  node.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
  const text = document.createElement("span");
  text.textContent = message;
  node.append(text);
  el.toasts.append(node);
  while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("is-in")));
  setTimeout(() => {
    node.classList.add("is-out");
    setTimeout(() => node.remove(), 360);
  }, tone === "error" ? 5200 : 2800);
}

function confirmAction({ title, text, confirm = "Delete" }) {
  return new Promise((resolve) => {
    let confirmed = false;
    el.confirmTitle.textContent = title;
    el.confirmText.textContent = text;
    el.confirmOk.textContent = confirm;
    const onConfirm = () => {
      confirmed = true;
      closeDialog(el.confirmDialog);
    };
    el.confirmOk.addEventListener("click", onConfirm);
    el.confirmDialog.addEventListener("close", () => {
      el.confirmOk.removeEventListener("click", onConfirm);
      resolve(confirmed);
    }, { once: true });
    openDialog(el.confirmDialog);
  });
}

/* ---------- Passcode ---------- */

function setupLock() {
  const length = PASSCODE.length;
  el.pinDots.replaceChildren(...Array.from({ length }, () => document.createElement("span")));
  let entered = "";
  let busy = false;

  const paint = () => {
    $$("span", el.pinDots).forEach((dot, index) => dot.classList.toggle("filled", index < entered.length));
  };

  const check = () => {
    if (entered === PASSCODE) {
      storage.set(KEYS.unlocked, "1", session());
      el.lock.classList.add("is-success");
      el.lockHint.textContent = "Welcome";
      el.lockStatus.textContent = "Unlocked";
      setTimeout(() => leaveScreen(el.lock, afterUnlock), 420);
      return;
    }
    el.lockCard.classList.remove("is-error");
    void el.lockCard.offsetWidth; // restart the shake animation
    el.lockCard.classList.add("is-error");
    el.lockHint.textContent = "Not quite, try again";
    el.lockStatus.textContent = "Wrong code, please try again";
    if (navigator.vibrate) navigator.vibrate(60);
    setTimeout(() => {
      entered = "";
      busy = false;
      paint();
      el.lockCard.classList.remove("is-error");
    }, 700);
  };

  const press = (digit) => {
    if (busy || entered.length >= length) return;
    entered += digit;
    paint();
    if (el.lockHint.textContent !== "Enter our code" && entered.length === 1) el.lockHint.textContent = "Enter our code";
    if (entered.length === length) {
      busy = true;
      setTimeout(check, 180);
    }
  };

  const erase = () => {
    if (busy || !entered) return;
    entered = entered.slice(0, -1);
    paint();
  };

  const flash = (key) => {
    const button = $(`[data-key="${key}"]`, el.keypad);
    if (!button) return;
    button.classList.add("is-pressed");
    setTimeout(() => button.classList.remove("is-pressed"), 150);
  };

  el.keypad.addEventListener("click", (event) => {
    const key = event.target.closest("[data-key]");
    if (!key || key.tagName !== "BUTTON") return;
    if (key.dataset.key === "back") erase();
    else press(key.dataset.key);
  });

  document.addEventListener("keydown", (event) => {
    if (el.lock.hidden || el.lock.classList.contains("is-leaving")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
      flash(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      erase();
      flash("back");
    }
  });
}

function leaveScreen(screen, then) {
  screen.classList.add("is-leaving");
  setTimeout(() => {
    screen.hidden = true;
    screen.classList.remove("is-leaving", "is-success");
    then();
  }, 560);
}

function afterUnlock() {
  if (state.me) startApp();
  else showWelcome();
}

/* ---------- Name ---------- */

function showWelcome({ rename = false } = {}) {
  closeMenus();
  el.welcomeEyebrow.textContent = rename ? "Your name" : "Welcome in";
  el.welcomeTitle.textContent = rename ? "Change your name" : "Who’s here?";
  el.welcomeText.textContent = rename
    ? "New photos and responses will use this name. Earlier ones keep the name they were shared with."
    : "Your name is shown next to the photos and notes you share.";
  el.nameInput.value = rename ? state.me : "";
  el.welcome.dataset.rename = rename ? "1" : "";
  el.welcome.hidden = false;
  if (matchMedia("(pointer: fine)").matches || rename) {
    setTimeout(() => el.nameInput.focus({ preventScroll: true }), 350);
  }
}

function setupWelcome() {
  el.nameForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = cleanName(el.nameInput.value);
    if (!name) {
      el.nameInput.focus();
      return;
    }
    state.me = name;
    storage.set(KEYS.name, name);
    el.nameInput.blur();
    leaveScreen(el.welcome, () => {
      if (state.started) {
        refreshIdentity();
        render();
      } else {
        startApp();
      }
    });
  });

  el.welcome.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.welcome.dataset.rename === "1") {
      leaveScreen(el.welcome, () => {});
    }
  });
}

/* ---------- Starting the space ---------- */

function hasFirebaseConfig() {
  // typeof keeps the site working (on this device only) even if the settings block is deleted
  return typeof firebaseConfig !== "undefined" && Boolean(firebaseConfig
    && String(firebaseConfig.apiKey || "").trim() && String(firebaseConfig.projectId || "").trim());
}

function startApp() {
  state.started = true;
  el.app.hidden = false;
  refreshIdentity();
  applyView(state.view, false);
  connect();
  setInterval(refreshTimes, 60000);
}

function refreshIdentity() {
  paintAvatar(el.meAvatar, state.me);
  paintAvatar(el.meMenuAvatar, state.me);
  el.meName.textContent = state.me;
  el.greeting.textContent = `${greetingFor()}, ${state.me}`;
  $$(".comment-form .avatar").forEach((avatar) => paintAvatar(avatar, state.me));
}

const RETRY_DELAYS = [1500, 4000, 10000, 25000, 60000];

// fresh: throw away the current connection and start a new one.
// quiet: reconnect in the background without touching what's on screen.
async function connect({ fresh = false, quiet = false } = {}) {
  const attempt = ++state.connection;
  clearTimeout(state.retryTimer);
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  if (fresh && state.store && state.store.dispose) {
    state.store.dispose();
    state.store = null;
  }
  if (!quiet && !state.loaded) {
    el.feedError.hidden = true;
    el.loading.hidden = false;
    clearTimeout(state.slowTimer);
    state.slowTimer = setTimeout(() => {
      if (!state.loaded && el.feedError.hidden) toast("Still connecting to your space…", "info");
    }, 9000);
  }

  try {
    if (!state.store) {
      const store = hasFirebaseConfig() ? new CloudStore(firebaseConfig) : new LocalStore();
      await store.init();
      if (attempt !== state.connection) {
        if (store.dispose) store.dispose();
        return;
      }
      state.store = store;
      renderSyncStatus();
    }
    state.unsubscribe = state.store.subscribe(
      (posts, meta) => {
        if (attempt === state.connection) onPosts(posts, meta);
      },
      (error) => {
        if (attempt === state.connection) onStoreError(error);
      },
    );
  } catch (error) {
    if (attempt === state.connection) onStoreError(error);
  }
}

// Coming back to the app, or back online, is the best moment to repair a connection that failed
function reconnectIfNeeded() {
  if (state.started && state.failures > 0) connect({ fresh: true, quiet: state.loaded });
}

// The connection is briefly missing while reconnecting; say so instead of silently doing nothing
function readyStore() {
  if (!state.store) toast("Reconnecting to your space. Try again in a moment.", "info");
  return state.store;
}

function renderSyncStatus() {
  const local = state.store.mode === "local";
  el.syncStatus.classList.toggle("is-local", local);
  el.syncStatus.disabled = !local;
  const dot = document.createElement("span");
  dot.className = "dot";
  const label = document.createElement("span");
  label.textContent = local ? "Saved on this device only" : "Synced for both of you";
  el.syncStatus.replaceChildren(dot, label);
  if (local) {
    const link = document.createElement("span");
    link.className = "status-link";
    link.textContent = "Set up";
    el.syncStatus.append(link);
  }
  el.setupNotice.hidden = !local || storage.get(KEYS.noticeDismissed) === "1";
}

function onPosts(posts, { confirmed = true } = {}) {
  // A new connection can report an empty list before the server has answered.
  // Wait for the real answer instead of flashing "Your first memory is waiting".
  if (!confirmed && posts.length === 0) return;
  clearTimeout(state.slowTimer);
  if (confirmed) {
    if (state.reconnecting) toast("Connected again");
    state.reconnecting = false;
    state.failures = 0;
    if (state.store && state.store.mode === "cloud") {
      clearTimeout(state.tidyTimer);
      state.tidyTimer = setTimeout(() => photoCache.tidy(state.posts.map((post) => post.id)), 5000);
    }
  }
  const firstLoad = !state.loaded;
  state.posts = posts;
  state.byId = new Map(posts.map((post) => [post.id, post]));
  state.loaded = true;
  el.loading.hidden = true;
  el.feedError.hidden = true;

  for (const [id, promise] of photoUrls) {
    if (!state.byId.has(id)) {
      photoUrls.delete(id);
      promise.then((url) => URL.revokeObjectURL(url), () => {});
    }
  }
  render(firstLoad);
}

function onStoreError(error) {
  console.error(error);
  clearTimeout(state.slowTimer);
  clearTimeout(state.retryTimer);
  state.unsubscribe = null;
  state.failures += 1;
  const code = errorCode(error);

  // Most problems (waking the phone, switching networks) pass within seconds, so keep
  // retrying with a brand-new connection. Missing rules can take longer to be fixed.
  if (code !== "no-storage") {
    const delay = code === "permission-denied"
      ? 60000
      : RETRY_DELAYS[Math.min(state.failures, RETRY_DELAYS.length) - 1];
    state.retryTimer = setTimeout(() => connect({ fresh: true, quiet: true }), delay);
  }

  if (state.loaded) {
    // Keep showing the photos that are already on screen
    if (code === "permission-denied") toast(friendlyError(error), "error");
    else if (!state.reconnecting) toast("Reconnecting to your space…", "info");
    state.reconnecting = true;
    return;
  }
  if (state.failures >= 3 || code === "permission-denied" || code === "no-storage") showConnectionError(error);
}

function errorCode(error) {
  return error && typeof error.code === "string" ? error.code : "";
}

function showConnectionError(error) {
  const code = errorCode(error);
  let message = "Something interrupted the connection. It keeps trying by itself, or tap Try again.";
  if (code === "permission-denied" || code === "resource-exhausted") {
    message = friendlyError(error);
  } else if (code === "no-storage") {
    message = "This browser doesn’t allow saving photos. Try opening the site in a normal, non-private window.";
  } else if (navigator.onLine === false) {
    message = "You seem to be offline. Your photos will appear as soon as you’re connected.";
  } else if (code === "sdk-unavailable") {
    message = "The connection to your space couldn’t load. Check your internet connection, then tap Try again.";
  }
  el.loading.hidden = true;
  el.feedErrorText.textContent = message;
  el.feedErrorDetail.textContent = describeError(error);
  el.errorGuideBtn.hidden = code !== "permission-denied";
  el.feedError.hidden = false;
  el.empty.hidden = true;
  el.fab.hidden = true;
}

// Small technical line on the error card, handy for a screenshot if something keeps failing
function describeError(error) {
  if (!error) return "";
  const label = errorCode(error) || error.name || "error";
  const text = String(error.message || error).replace(/^FirebaseError:\s*/i, "").replace(/^\[code=[^\]]*\]:\s*/i, "");
  return `Details: ${label}${text ? ` · ${text}` : ""}`.slice(0, 220);
}

/* ---------- Rendering ---------- */

function render(firstLoad = false) {
  const count = state.posts.length;
  el.stats.textContent = count ? `${count} ${count === 1 ? "memory" : "memories"}` : "";
  el.viewSwitch.hidden = count === 0;
  el.fab.hidden = count === 0; // the empty state has its own button
  el.empty.hidden = count > 0 || !el.feedError.hidden;
  el.feedEnd.hidden = count < 3;
  reconcile(el.feed, cards, createCard, updateCard, firstLoad);
  reconcile(el.gallery, tiles, createTile, updateTile, firstLoad);
  refreshViewer();
  scheduleCaptionCheck();
}

// Keeps existing elements (and their loaded photos) and only adds, moves or removes what changed.
function reconcile(container, cache, create, update, firstLoad) {
  for (const [id, node] of cache) {
    if (state.byId.has(id)) continue;
    cache.delete(id);
    node.classList.add("is-leaving");
    setTimeout(() => node.remove(), 360);
  }

  let previous = null;
  state.posts.forEach((post, index) => {
    let node = cache.get(post.id);
    if (!node) {
      node = create(post);
      cache.set(post.id, node);
      node.style.setProperty("--stagger", firstLoad ? String(Math.min(index, 8)) : "0");
      node.classList.add("is-new");
      const settle = (event) => {
        if (event.target !== node) return;
        node.classList.remove("is-new");
        node.removeEventListener("animationend", settle);
      };
      node.addEventListener("animationend", settle);
    }
    update(node, post);
    let expected = previous ? previous.nextElementSibling : container.firstElementChild;
    while (expected && expected.classList.contains("is-leaving")) expected = expected.nextElementSibling;
    if (expected !== node) container.insertBefore(node, expected);
    previous = node;
  });
}

function createCard(post, { viewer = false } = {}) {
  const node = el.postTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = post.id;
  const media = $(".post-media", node);
  if (viewer) {
    media.remove();
    node.classList.remove("glass");
    node.classList.add("post--viewer");
  } else {
    media.style.setProperty("--ratio", String(clampRatio(post.width, post.height)));
    if (post.thumb) $(".post-blur", node).style.backgroundImage = `url("${post.thumb}")`;
    const img = $(".post-img", node);
    img.alt = post.caption ? post.caption.slice(0, 140) : `Photo shared by ${post.author}`;
    observePhoto(img, post.id);
  }
  paintAvatar($(".comment-form .avatar", node), state.me);
  return node;
}

function updateCard(node, post) {
  paintAvatar($(".post-head .avatar", node), post.author);
  $(".post-author", node).textContent = post.author;
  paintTime($(".post-time", node), post.createdAt);

  const caption = $(".post-caption", node);
  if (caption.textContent !== post.caption) caption.textContent = post.caption;
  caption.hidden = !post.caption;
  const captionOpen = node.classList.contains("post--viewer") || state.openCaptions.has(post.id);
  caption.classList.toggle("is-clamped", !captionOpen);
  if (captionOpen || !post.caption) $(".caption-toggle", node).hidden = true;

  const liked = post.likes.includes(state.me);
  $(".like-btn", node).setAttribute("aria-pressed", String(liked));
  renderLikedBy($(".liked-by", node), post.likes);

  $(".comment-count", node).textContent = post.comments.length ? String(post.comments.length) : "";
  renderComments(node, post);
}

function renderLikedBy(node, likes) {
  node.replaceChildren();
  if (!likes.length) return;
  const names = [...likes]
    .sort((a, b) => Number(b === state.me) - Number(a === state.me))
    .map((name) => (name === state.me ? "you" : name));
  const strong = (text) => {
    const b = document.createElement("b");
    b.textContent = text;
    return b;
  };
  node.append("Liked by ");
  if (names.length === 1) node.append(strong(names[0]));
  else if (names.length === 2) node.append(strong(names[0]), " & ", strong(names[1]));
  else node.append(strong(names[0]), ", ", strong(names[1]), ` & ${names.length - 2} more`);
}

function renderComments(node, post) {
  const list = $(".comment-list", node);
  const toggle = $(".comments-toggle", node);
  const inViewer = node.classList.contains("post--viewer");
  const all = post.comments;
  const expanded = inViewer || state.expanded.has(post.id);
  const visible = expanded || all.length <= 2 ? all : all.slice(-2);

  toggle.hidden = inViewer || all.length <= 2;
  toggle.textContent = expanded ? "Show fewer responses" : `View all ${all.length} responses`;

  const signature = `${state.me}#${visible.map((c) => `${c.id}:${c.author}`).join("|")}`;
  if (list.dataset.signature === signature) {
    $$("time", list).forEach((time) => paintTime(time, Number(time.dataset.ts)));
    return;
  }
  const rendered = list.dataset.signature !== undefined;
  const known = new Set($$(".comment", list).map((item) => item.dataset.commentId));
  list.replaceChildren(...visible.map((comment) => createComment(comment, rendered && !known.has(comment.id))));
  list.dataset.signature = signature;
}

function createComment(comment, animate) {
  const item = document.createElement("li");
  item.className = animate ? "comment is-new" : "comment";
  item.dataset.commentId = comment.id;

  const avatar = document.createElement("span");
  avatar.className = "avatar avatar--xs";
  paintAvatar(avatar, comment.author);

  const main = document.createElement("div");
  main.className = "comment-main";
  const text = document.createElement("p");
  text.className = "comment-text";
  const author = document.createElement("span");
  author.className = "comment-author";
  author.textContent = cleanName(comment.author) || "Someone";
  text.append(author, document.createTextNode(comment.text));

  const meta = document.createElement("div");
  meta.className = "comment-meta";
  const time = document.createElement("time");
  paintTime(time, Number(comment.createdAt) || Date.now());
  meta.append(time);
  if (comment.author === state.me) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "text-btn";
    remove.dataset.action = "delete-comment";
    remove.textContent = "Delete";
    meta.append(remove);
  }
  main.append(text, meta);
  item.append(avatar, main);
  return item;
}

let captionFrame = 0;
function scheduleCaptionCheck() {
  cancelAnimationFrame(captionFrame);
  captionFrame = requestAnimationFrame(() => {
    cards.forEach((node) => {
      const caption = $(".post-caption", node);
      const toggle = $(".caption-toggle", node);
      if (caption.hidden || !caption.classList.contains("is-clamped") || !caption.clientHeight) {
        if (!caption.classList.contains("is-clamped") || caption.hidden) toggle.hidden = true;
        return;
      }
      toggle.hidden = caption.scrollHeight <= caption.clientHeight + 2;
    });
  });
}

function createTile(post) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.dataset.id = post.id;
  tile.dataset.action = "open";
  tile.innerHTML = `
    <span class="tile-blur"></span>
    <img class="tile-img" alt="" draggable="false">
    <span class="tile-info" aria-hidden="true">
      <span class="tile-stat tile-likes"><svg class="icon"><use href="#i-heart"/></svg><span></span></span>
      <span class="tile-stat tile-comments"><svg class="icon"><use href="#i-comment"/></svg><span></span></span>
    </span>`;
  if (post.thumb) $(".tile-blur", tile).style.backgroundImage = `url("${post.thumb}")`;
  observePhoto($(".tile-img", tile), post.id);
  return tile;
}

function updateTile(tile, post) {
  const likes = post.likes.length;
  const comments = post.comments.length;
  tile.setAttribute("aria-label", `Photo from ${post.author}${post.caption ? `: ${post.caption.slice(0, 80)}` : ""}`);
  tile.classList.toggle("has-activity", likes + comments > 0);
  const likeStat = $(".tile-likes", tile);
  likeStat.hidden = !likes;
  likeStat.classList.toggle("is-liked", post.likes.includes(state.me));
  $("span", likeStat).textContent = String(likes);
  const commentStat = $(".tile-comments", tile);
  commentStat.hidden = !comments;
  $("span", commentStat).textContent = String(comments);
}

function refreshTimes() {
  $$("time[data-ts]").forEach((time) => {
    time.textContent = timeAgo(Number(time.dataset.ts));
  });
  if (state.me) el.greeting.textContent = `${greetingFor()}, ${state.me}`;
}

/* ---------- Photos ---------- */

const photoObserver = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      photoObserver.unobserve(entry.target);
      showPhoto(entry.target);
    });
  }, { rootMargin: "900px 0px" })
  : null;

function observePhoto(img, id) {
  img.dataset.photo = id;
  if (photoObserver) photoObserver.observe(img);
  else showPhoto(img);
}

function photoUrl(id) {
  if (!photoUrls.has(id)) {
    if (!state.store) return Promise.reject(Object.assign(new Error("Not connected yet"), { code: "unavailable" }));
    const promise = state.store.getPhoto(id).then((blob) => URL.createObjectURL(blob));
    promise.catch(() => {
      if (photoUrls.get(id) === promise) photoUrls.delete(id);
    });
    photoUrls.set(id, promise);
  }
  return photoUrls.get(id);
}

function showPhoto(img, attempt = 0) {
  const id = img.dataset.photo;
  photoUrl(id).then((url) => {
    img.addEventListener("load", () => img.parentElement.classList.add("is-loaded"), { once: true });
    img.src = url;
  }).catch((error) => {
    if (attempt === 0) console.warn("Photo not available yet", id, error);
    const delay = Math.min(15000, 2000 * 2 ** attempt);
    setTimeout(() => {
      if (img.isConnected && state.byId.has(id)) showPhoto(img, attempt + 1);
    }, delay);
  });
}

function burst(container) {
  const heart = $(".heart-burst", container);
  if (!heart) return;
  heart.classList.remove("is-active");
  void heart.offsetWidth;
  heart.classList.add("is-active");
}

function pop(button) {
  button.classList.remove("is-popping");
  void button.offsetWidth;
  button.classList.add("is-popping");
  setTimeout(() => button.classList.remove("is-popping"), 600);
}

/* ---------- Viewer ---------- */

function openViewer(id) {
  const post = state.byId.get(id);
  if (!post) return;
  closeMenus();
  state.viewerId = id;
  state.viewerCard = createCard(post, { viewer: true });
  updateCard(state.viewerCard, post);
  el.viewerSide.replaceChildren(state.viewerCard);
  el.viewerSide.scrollTop = 0;
  $(".viewer-panel", el.viewer).scrollTop = 0;

  el.viewerMedia.classList.remove("is-loaded");
  el.viewerBlur.style.backgroundImage = post.thumb ? `url("${post.thumb}")` : "";
  el.viewerImg.alt = post.caption ? post.caption.slice(0, 140) : `Photo shared by ${post.author}`;
  el.viewerImg.removeAttribute("src");
  photoUrl(id).then((url) => {
    if (state.viewerId !== id) return;
    el.viewerImg.onload = () => {
      if (state.viewerId === id) el.viewerMedia.classList.add("is-loaded");
    };
    el.viewerImg.src = url;
  }).catch((error) => toast(friendlyError(error, "Couldn’t load this photo."), "error"));

  updateViewerNav();
  openDialog(el.viewer);
}

function refreshViewer() {
  if (!state.viewerId || !el.viewer.open || el.viewer._closing) return;
  const post = state.byId.get(state.viewerId);
  if (!post) {
    closeDialog(el.viewer);
    return;
  }
  updateCard(state.viewerCard, post);
  updateViewerNav();
}

function updateViewerNav() {
  const index = state.posts.findIndex((post) => post.id === state.viewerId);
  el.viewerPrev.disabled = index <= 0;
  el.viewerNext.disabled = index < 0 || index >= state.posts.length - 1;
}

function stepViewer(delta) {
  const index = state.posts.findIndex((post) => post.id === state.viewerId);
  const next = index >= 0 ? state.posts[index + delta] : null;
  if (next) openViewer(next.id);
}

function updateEverywhere(id) {
  const post = state.byId.get(id);
  if (!post) return;
  if (cards.has(id)) updateCard(cards.get(id), post);
  if (tiles.has(id)) updateTile(tiles.get(id), post);
  if (state.viewerId === id && state.viewerCard) updateCard(state.viewerCard, post);
  scheduleCaptionCheck();
}

/* ---------- Likes and responses ---------- */

function toggleLike(id, onlyLike = false) {
  const post = state.byId.get(id);
  if (!post) return;
  const liked = post.likes.includes(state.me);
  if (onlyLike && liked) return;
  const store = readyStore();
  if (!store) return;
  const next = !liked;
  post.likes = next ? [...post.likes, state.me] : post.likes.filter((name) => name !== state.me);
  updateEverywhere(id);
  if (next) $$(`[data-id="${CSS.escape(id)}"] .like-btn`).forEach(pop);
  store.setLike(id, state.me, next).catch((error) => {
    toast(friendlyError(error, "Couldn’t save that like."), "error");
  });
}

let lastTap = { id: null, time: 0, timer: 0 };

function handleMediaTap(id, media) {
  const now = Date.now();
  clearTimeout(lastTap.timer);
  if (lastTap.id === id && now - lastTap.time < 320) {
    lastTap = { id: null, time: 0, timer: 0 };
    burst(media);
    toggleLike(id, true);
    return;
  }
  lastTap = {
    id,
    time: now,
    timer: setTimeout(() => {
      lastTap = { id: null, time: 0, timer: 0 };
      openViewer(id);
    }, 320),
  };
}

function sendComment(form) {
  const holder = form.closest("[data-id]");
  const input = $(".comment-input", form);
  const text = input.value.replace(/\s+/g, " ").trim().slice(0, 500);
  const post = holder && state.byId.get(holder.dataset.id);
  if (!text || !post) return;
  const store = readyStore();
  if (!store) return;
  const comment = { id: uid(), author: state.me, text, createdAt: Date.now() };
  input.value = "";
  $(".send-btn", form).disabled = true;
  post.comments = [...post.comments, comment];
  updateEverywhere(post.id);
  store.addComment(post.id, comment).catch((error) => {
    toast(friendlyError(error, "Couldn’t send that response."), "error");
    if (!input.value) {
      input.value = text;
      $(".send-btn", form).disabled = false;
    }
  });
}

async function deleteComment(postId, commentId) {
  const post = state.byId.get(postId);
  const comment = post && post.comments.find((item) => item.id === commentId);
  if (!comment) return;
  const confirmed = await confirmAction({
    title: "Delete response?",
    text: "It will be removed for both of you.",
    confirm: "Delete",
  });
  const store = confirmed && readyStore();
  if (!store) return;
  store.deleteComment(postId, comment).catch((error) => {
    toast(friendlyError(error, "Couldn’t delete that response."), "error");
  });
}

/* ---------- Post options ---------- */

function openPostMenu(button, id) {
  const post = state.byId.get(id);
  if (!post) return;
  const wasOpenHere = state.menuAnchor === button && !el.postMenu.hidden;
  closeMenus();
  if (wasOpenHere) return;

  const items = [{ action: "save", icon: "download", label: "Save photo" }];
  if (post.author === state.me) {
    items.push({ action: "edit", icon: "edit", label: post.caption ? "Edit caption" : "Add a caption" });
    items.push({ action: "delete", icon: "trash", label: "Delete memory", danger: true });
  }
  el.postMenu.replaceChildren(...items.map((item) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = item.danger ? "menu-item menu-item--danger" : "menu-item";
    option.dataset.menu = item.action;
    option.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${item.icon}"/></svg>`;
    option.append(item.label);
    return option;
  }));
  el.postMenu.dataset.id = id;

  const host = button.closest("dialog") || document.body;
  if (el.postMenu.parentElement !== host) host.appendChild(el.postMenu);
  showMenu(el.postMenu);

  const rect = button.getBoundingClientRect();
  const width = el.postMenu.offsetWidth;
  const height = el.postMenu.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  let top = rect.bottom + 6;
  let origin = "top right";
  if (top + height > window.innerHeight - 12) {
    top = Math.max(12, rect.top - height - 6);
    origin = "bottom right";
  }
  el.postMenu.style.left = `${Math.max(12, Math.min(viewportWidth - width - 12, rect.right - width))}px`;
  el.postMenu.style.top = `${top}px`;
  el.postMenu.style.transformOrigin = origin;

  state.menuAnchor = button;
  button.setAttribute("aria-expanded", "true");
}

async function savePhoto(id) {
  const post = state.byId.get(id);
  if (!post) return;
  try {
    const url = await photoUrl(id);
    const date = new Date(post.createdAt || Date.now());
    const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
    const filename = `just-us-${stamp}.jpg`;

    if (navigator.canShare && matchMedia("(pointer: coarse)").matches) {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (error) {
          if (error && error.name === "AbortError") return;
        }
      }
    }

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    toast(friendlyError(error, "Couldn’t save that photo."), "error");
  }
}

function openEditor(id) {
  const post = state.byId.get(id);
  if (!post) return;
  state.editingId = id;
  el.editorTitle.textContent = post.caption ? "Edit caption" : "Add a caption";
  el.editorInput.value = post.caption;
  openDialog(el.editor);
  setTimeout(() => {
    el.editorInput.focus();
    const end = el.editorInput.value.length;
    el.editorInput.setSelectionRange(end, end);
  }, 80);
}

async function deletePost(id) {
  const confirmed = await confirmAction({
    title: "Delete this memory?",
    text: "The photo, its likes and its responses will be removed for both of you. This can’t be undone.",
    confirm: "Delete",
  });
  if (!confirmed || !state.byId.has(id)) return;
  const store = readyStore();
  if (!store) return;
  if (state.viewerId === id) closeDialog(el.viewer);
  store.deletePost(id)
    .then(() => toast("Memory deleted"))
    .catch((error) => toast(friendlyError(error, "Couldn’t delete that memory."), "error"));
}

/* ---------- New memory ---------- */

const composer = { file: null, preparing: null, previewUrl: null, busy: false, token: 0 };

function openComposer(file) {
  if (!readyStore()) return;
  closeMenus();
  resetComposer();
  openDialog(el.composer);
  if (file) selectFile(file);
}

function resetComposer() {
  if (composer.previewUrl) URL.revokeObjectURL(composer.previewUrl);
  composer.file = null;
  composer.preparing = null;
  composer.previewUrl = null;
  composer.busy = false;
  composer.token += 1;
  el.fileInput.value = "";
  el.previewImg.hidden = true;
  el.previewImg.removeAttribute("src");
  el.changePhoto.hidden = true;
  el.dropzone.classList.remove("has-photo", "is-dragging");
  el.captionInput.value = "";
  autoGrow(el.captionInput);
  updateCounter();
  setShareBusy(false);
}

function imageErrorMessage(error) {
  if (error && error.code === "too-large") return "That photo is too large to share. Try a smaller one.";
  return "This photo can’t be opened here. Try a JPG or PNG.";
}

function selectFile(file) {
  if (!file) return;
  if (file.type && !file.type.startsWith("image/")) {
    toast("Please choose a photo.", "error");
    return;
  }
  if (composer.previewUrl) URL.revokeObjectURL(composer.previewUrl);
  const token = ++composer.token;
  composer.file = file;
  composer.previewUrl = URL.createObjectURL(file);
  el.previewImg.src = composer.previewUrl;
  el.previewImg.hidden = false;
  el.changePhoto.hidden = false;
  el.dropzone.classList.add("has-photo");
  setShareBusy(false);

  composer.preparing = prepareImage(file);
  composer.preparing.catch((error) => {
    error.reported = true;
    if (token !== composer.token) return;
    toast(imageErrorMessage(error), "error");
    composer.file = null;
    composer.preparing = null;
    el.previewImg.hidden = true;
    el.previewImg.removeAttribute("src");
    el.changePhoto.hidden = true;
    el.dropzone.classList.remove("has-photo");
    setShareBusy(false);
  });
}

function setShareBusy(busy) {
  el.shareBtn.classList.toggle("is-busy", busy);
  el.shareBtn.disabled = busy || !composer.file;
  $(".btn-label", el.shareBtn).textContent = busy ? "Sharing…" : "Share";
}

async function shareMemory() {
  if (composer.busy || !composer.preparing) return;
  const token = composer.token;
  composer.busy = true;
  setShareBusy(true);
  let upload = null;
  try {
    const prepared = await composer.preparing;
    const caption = el.captionInput.value.trim().slice(0, 600);
    if (!state.store) throw Object.assign(new Error("Reconnecting"), { code: "unavailable" });
    upload = state.store.addPost({ id: uid(), author: state.me, caption, ...prepared });
    await withTimeout(upload, UPLOAD_PATIENCE_MS);
    composer.busy = false;
    closeDialog(el.composer);
    toast("Shared with love", "love");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    if (error && error.code === "timeout") {
      composer.busy = false;
      closeDialog(el.composer);
      toast("Still uploading. It will appear for both of you shortly.", "info");
      upload.catch((uploadError) => {
        toast(friendlyError(uploadError, "That photo couldn’t be shared. Please try again."), "error");
      });
      return;
    }
    if (token === composer.token) {
      composer.busy = false;
      setShareBusy(false);
    }
    if (!error || !error.reported) {
      const imageProblem = error && (error.code === "unreadable" || error.code === "too-large");
      toast(imageProblem ? imageErrorMessage(error) : friendlyError(error, "Couldn’t share that photo. Please try again."), "error");
    }
  }
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  if (textarea.value) textarea.style.height = `${Math.min(textarea.scrollHeight + 2, 220)}px`;
}

function updateCounter() {
  const length = el.captionInput.value.length;
  el.captionCount.textContent = length > 450 ? `${length}/600` : "";
}

function firstImage(dataTransfer) {
  return Array.from((dataTransfer && dataTransfer.files) || []).find((file) => file.type.startsWith("image/")) || null;
}

function hasFiles(event) {
  return Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes("Files"));
}

/* ---------- Layout switch ---------- */

function applyView(view, animate = true) {
  state.view = view;
  storage.set(KEYS.view, view);
  const gallery = view === "gallery";
  el.feed.hidden = gallery;
  el.gallery.hidden = !gallery;
  el.content.classList.toggle("is-gallery", gallery);
  el.viewSwitch.classList.toggle("is-gallery", gallery);
  $$("button", el.viewSwitch).forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  });
  const shown = gallery ? el.gallery : el.feed;
  if (animate && shown.animate && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shown.animate(
      [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }],
      { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }
  if (!gallery) scheduleCaptionCheck();
}

/* ---------- Events ---------- */

function setupEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const holder = target.closest("[data-id]");
    const id = holder ? holder.dataset.id : null;
    if (!id) return;
    switch (target.dataset.action) {
      case "media":
        handleMediaTap(id, target);
        break;
      case "open":
        openViewer(id);
        break;
      case "like":
        toggleLike(id);
        break;
      case "focus-comment": {
        const input = $(".comment-input", holder);
        if (input) input.focus();
        break;
      }
      case "toggle-comments":
        if (state.expanded.has(id)) state.expanded.delete(id);
        else state.expanded.add(id);
        updateEverywhere(id);
        break;
      case "caption":
        state.openCaptions.add(id);
        updateEverywhere(id);
        break;
      case "menu":
        openPostMenu(target, id);
        break;
      case "delete-comment": {
        const item = target.closest("[data-comment-id]");
        if (item) deleteComment(id, item.dataset.commentId);
        break;
      }
      default:
        break;
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest(".comment-form");
    if (!form) return;
    event.preventDefault();
    sendComment(form);
  });

  document.addEventListener("input", (event) => {
    if (!event.target.matches(".comment-input")) return;
    const button = $(".send-btn", event.target.closest(".comment-form"));
    if (button) button.disabled = !event.target.value.trim();
  });

  // On phones the add button would sit on top of the keyboard while typing a response
  document.addEventListener("focusin", (event) => {
    if (event.target.matches(".comment-input") && matchMedia("(pointer: coarse)").matches) {
      el.fab.classList.add("is-hidden");
    }
  });

  document.addEventListener("focusout", (event) => {
    if (event.target.matches(".comment-input")) el.fab.classList.remove("is-hidden");
  });

  // Menus
  el.meBtn.addEventListener("click", () => {
    const open = !el.meMenu.hidden && el.meMenu.classList.contains("is-open");
    closeMenus();
    if (!open) {
      showMenu(el.meMenu);
      el.meBtn.setAttribute("aria-expanded", "true");
    }
  });

  el.postMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-menu]");
    if (!option) return;
    const id = el.postMenu.dataset.id;
    closeMenus();
    if (option.dataset.menu === "save") savePhoto(id);
    if (option.dataset.menu === "edit") openEditor(id);
    if (option.dataset.menu === "delete") deletePost(id);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".menu, [data-action='menu'], #meBtn")) closeMenus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (!el.postMenu.hidden || !el.meMenu.hidden)) {
      event.preventDefault();
      closeMenus();
      return;
    }
    if (el.viewer.open && !event.target.closest("input, textarea")) {
      if (event.key === "ArrowLeft") stepViewer(-1);
      if (event.key === "ArrowRight") stepViewer(1);
    }
  });

  window.addEventListener("resize", () => {
    closeMenus();
    scheduleCaptionCheck();
  });

  el.syncStatus.addEventListener("click", () => {
    closeMenus();
    openDialog(el.guide);
  });

  el.renameBtn.addEventListener("click", () => showWelcome({ rename: true }));

  el.lockBtn.addEventListener("click", () => {
    closeMenus();
    storage.remove(KEYS.unlocked, session());
    el.app.classList.add("is-leaving");
    setTimeout(() => window.location.reload(), 480);
  });

  // Top bar reacts to scrolling; on phones the add button tucks away while scrolling down
  let lastY = window.scrollY;
  const phone = matchMedia("(pointer: coarse)");
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    el.topbar.classList.toggle("is-scrolled", y > 8);
    if (Math.abs(y - lastY) < 8) return;
    const typing = document.activeElement && document.activeElement.matches(".comment-input");
    if (!typing) el.fab.classList.toggle("is-hidden", phone.matches && y > lastY && y > 280);
    lastY = y;
    if (!el.meMenu.hidden) closeMenus();
  }, { passive: true });

  // Layout
  el.viewSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button && button.dataset.view !== state.view) applyView(button.dataset.view);
  });

  // Notice and guide
  el.noticeDismiss.addEventListener("click", () => {
    storage.set(KEYS.noticeDismissed, "1");
    el.setupNotice.hidden = true;
  });
  el.noticeGuideBtn.addEventListener("click", () => openDialog(el.guide));
  el.copyRules.addEventListener("click", async () => {
    const label = $("span", el.copyRules);
    try {
      await navigator.clipboard.writeText(el.rulesCode.textContent);
    } catch (_) {
      const range = document.createRange();
      range.selectNodeContents(el.rulesCode);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("copy");
      selection.removeAllRanges();
    }
    label.textContent = "Copied";
    setTimeout(() => {
      label.textContent = "Copy";
    }, 1800);
  });

  el.retryBtn.addEventListener("click", () => connect({ fresh: true }));
  el.errorGuideBtn.addEventListener("click", () => openDialog(el.guide));

  // New memory
  el.fab.addEventListener("click", () => openComposer());
  el.emptyAddBtn.addEventListener("click", () => openComposer());

  el.dropzone.addEventListener("click", (event) => {
    if (event.target !== el.fileInput && !composer.busy) el.fileInput.click();
  });
  el.dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!composer.busy) el.fileInput.click();
    }
  });
  el.fileInput.addEventListener("change", () => {
    const file = el.fileInput.files && el.fileInput.files[0];
    if (file) selectFile(file);
    el.fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      el.dropzone.classList.add("is-dragging");
    });
  });
  el.dropzone.addEventListener("dragleave", (event) => {
    if (!el.dropzone.contains(event.relatedTarget)) el.dropzone.classList.remove("is-dragging");
  });
  el.dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    el.dropzone.classList.remove("is-dragging");
    if (composer.busy) return;
    const file = firstImage(event.dataTransfer);
    if (file) selectFile(file);
    else toast("Please drop a photo.", "error");
  });

  window.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (el.app.hidden || !state.store || composer.busy) return;
    const file = firstImage(event.dataTransfer);
    if (!file) return;
    if (el.composer.open) selectFile(file);
    else if (!$("dialog[open]")) openComposer(file);
  });

  document.addEventListener("paste", (event) => {
    if (el.app.hidden || !state.store || composer.busy) return;
    const file = Array.from((event.clipboardData && event.clipboardData.files) || []).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    if (el.composer.open) {
      event.preventDefault();
      selectFile(file);
    } else if (!$("dialog[open]")) {
      event.preventDefault();
      openComposer(file);
    }
  });

  el.captionInput.addEventListener("input", () => {
    autoGrow(el.captionInput);
    updateCounter();
  });
  el.captionInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      shareMemory();
    }
  });
  el.composerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    shareMemory();
  });
  el.composer.addEventListener("close", () => {
    if (!composer.busy) resetComposer();
  });

  // Caption editor
  el.editorForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = state.editingId;
    const post = state.byId.get(id);
    const caption = el.editorInput.value.trim().slice(0, 600);
    if (!post || caption === post.caption) {
      closeDialog(el.editor);
      return;
    }
    const store = readyStore();
    if (!store) return; // keep the dialog open so the new caption isn't lost
    closeDialog(el.editor);
    post.caption = caption;
    updateEverywhere(id);
    store.updateCaption(id, caption).catch((error) => {
      toast(friendlyError(error, "Couldn’t update the caption."), "error");
    });
  });

  // Viewer
  el.viewerPrev.addEventListener("click", () => stepViewer(-1));
  el.viewerNext.addEventListener("click", () => stepViewer(1));
  el.viewer.addEventListener("close", () => {
    state.viewerId = null;
    state.viewerCard = null;
    el.viewerImg.removeAttribute("src");
  });

  let viewerTap = 0;
  el.viewerMedia.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    if (event.target !== el.viewerImg) {
      closeDialog(el.viewer);
      return;
    }
    const now = Date.now();
    if (now - viewerTap < 320) {
      viewerTap = 0;
      burst(el.viewerMedia);
      if (state.viewerId) toggleLike(state.viewerId, true);
    } else {
      viewerTap = now;
    }
  });

  let swipe = null;
  el.viewerMedia.addEventListener("touchstart", (event) => {
    swipe = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  el.viewerMedia.addEventListener("touchend", (event) => {
    if (!swipe) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepViewer(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Connection status (shared mode)
  window.addEventListener("offline", () => {
    if (state.store && state.store.mode === "cloud") toast("You’re offline. Changes will sync when you’re back.", "info");
  });
  window.addEventListener("online", () => {
    if (state.failures > 0) reconnectIfNeeded(); // shows "Connected again" once it works
    else if (state.store && state.store.mode === "cloud") toast("Back online");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.started) return;
    refreshTimes();
    reconnectIfNeeded();
  });
  // iPhone home-screen apps are often restored from memory instead of reloaded
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) reconnectIfNeeded();
  });
}

/* ---------- Home-screen app on Android ---------- */

// iPhones take the home-screen icon from index.html. Android needs a web app manifest to install
// the site as an app, so one is built here from the same icon (keeping the project at three files).
async function setupAndroidManifest() {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  if (apple || !/^https?:$/.test(window.location.protocol) || $('link[rel="manifest"]')) return;
  try {
    const source = new Image();
    source.src = $('link[rel="icon"]').href;
    await source.decode();
    const icon = (size, purpose) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      canvas.getContext("2d").drawImage(source, 0, 0, size, size);
      return { src: canvas.toDataURL("image/png"), sizes: `${size}x${size}`, type: "image/png", purpose };
    };
    const large = icon(512, "any");
    const manifest = {
      name: "Just Us",
      short_name: "Just Us",
      start_url: window.location.origin + window.location.pathname,
      scope: new URL("./", window.location.href).href,
      display: "standalone",
      background_color: "#f5efea",
      theme_color: "#f5efea",
      icons: [icon(192, "any"), large, { ...large, purpose: "maskable" }],
    };
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
    document.head.appendChild(link);
  } catch (_) {
    /* optional: the site works the same without it */
  }
}

/* ---------- Start ---------- */

// Netlify gives every upload its own "permalink" (1234abcd…--name.netlify.app) that shows that one
// upload forever. Move to the main address so a home-screen icon never gets stuck on an old version.
function leaveFrozenDeployLink() {
  const match = window.location.hostname.match(/^[0-9a-f]{24}--(.+\.netlify\.app)$/i);
  if (!match) return false;
  const { pathname, search, hash } = window.location;
  window.location.replace(`https://${match[1]}${pathname}${search}${hash}`);
  return true;
}

function boot() {
  if (leaveFrozenDeployLink()) return;
  setupDialogs();
  setupLock();
  setupWelcome();
  setupEvents();
  if (storage.get(KEYS.unlocked, session()) === "1") afterUnlock();
  else el.lock.hidden = false;
  setTimeout(setupAndroidManifest, 1500);
}

boot();
