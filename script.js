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
  shnotterBtn: $("#shnotterBtn"),
  shnotter: $("#shnotter"),
  shOcean: $("#shOcean"),
  shSea: $("#shSea"),
  shDark: $("#shDark"),
  shBeam: $("#shBeam"),
  shEyes: $("#shEyes"),
  shDust: $("#shDust"),
  shOtter: $("#shOtter"),
  shZoom: $("#shZoom"),
  shBody: $("#shBody"),
  shPlush: $("#shPlush"),
  shShade: $("#shShade"),
  shHearts: $("#shHearts"),
  shFlash: $("#shFlash"),
  shCaption: $("#shCaption"),
  shMessage: $("#shMessage"),
  shReturn: $("#shReturn"),
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
  const open = $$("dialog.modal[open]").filter((dialog) => !dialog._closing);
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

/* ---------- Shnotter special ---------- */

// The lights go out, the plush otter sneaks up on you and boops the screen, then everything fills
// with hearts and floating sea otters. The timing lives here; the look lives in styles.css (.sh-…).

const sh = {
  open: false,
  closing: false,
  love: false,
  token: 0, // changes whenever the show starts or stops; older steps notice and quietly stop
  anims: new Set(),
  timers: new Set(),
  pushedHistory: false,
  opener: null,
};

const SH_HEART_COLORS = ["#f28b9d", "#e4677f", "#f7b3c0", "#ffd3dc", "#d94a68", "#fbbfa6"];

class ShnotterStopped extends Error {}

function shCheck(token) {
  if (token !== sh.token) throw new ShnotterStopped();
}

function shLater(fn, ms) {
  const timer = setTimeout(() => {
    sh.timers.delete(timer);
    fn();
  }, ms);
  sh.timers.add(timer);
}

function shWait(token, ms) {
  return new Promise((resolve) => shLater(resolve, ms)).then(() => shCheck(token));
}

function shAnimate(node, keyframes, options) {
  const animation = node.animate(keyframes, { fill: "forwards", ...options });
  sh.anims.add(animation);
  // Animations that hold their end state stay tracked until the show resets; the rest forget themselves
  const fill = animation.effect.getTiming().fill;
  if (fill === "none" || fill === "backwards") {
    const forget = () => sh.anims.delete(animation);
    animation.finished.then(forget, forget);
  }
  return animation;
}

// Runs animations together and waits for all of them, then keeps where they ended as plain styles
async function shPlay(token, steps) {
  shCheck(token);
  const running = steps.map(([node, keyframes, options]) => shAnimate(node, keyframes, options));
  await Promise.all(running.map((animation) => animation.finished.catch(() => {})));
  shCheck(token);
  running.forEach((animation) => {
    try {
      animation.commitStyles();
    } catch (_) {
      /* nothing to keep */
    }
    animation.cancel();
    sh.anims.delete(animation);
  });
}

function shPose(x, y, scale, rotate = 0) {
  return `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${rotate}deg) scale(${scale.toFixed(3)})`;
}

function shCaption(text) {
  if (text) {
    el.shCaption.textContent = text;
    shAnimate(el.shCaption, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: "ease-out" });
  } else {
    const text = el.shCaption.textContent;
    const fade = shAnimate(el.shCaption, [{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: "ease-in" });
    fade.finished.then(() => {
      if (el.shCaption.textContent === text) el.shCaption.textContent = "";
    }, () => {});
  }
}

// Specks of dust floating in the spotlight, scattered inside the cone of light
function shMotes() {
  const box = el.shDust.getBoundingClientRect();
  const motes = Array.from({ length: 22 }, () => {
    const mote = document.createElement("i");
    const down = 0.06 + Math.random() * 0.7; // how far down the beam
    const spread = Math.tan((15 * Math.PI) / 180) * (down * box.height + window.innerHeight * 0.06);
    const x = box.width / 2 + (Math.random() * 2 - 1) * spread * 0.85;
    mote.style.setProperty("--x", `${x.toFixed(0)}px`);
    mote.style.setProperty("--y", `${(down * box.height).toFixed(0)}px`);
    mote.style.setProperty("--d", `${(1 + Math.random() * 2.2).toFixed(1)}px`);
    mote.style.setProperty("--o", (0.25 + Math.random() * 0.6).toFixed(2));
    mote.style.setProperty("--t", `${(5 + Math.random() * 7).toFixed(1)}s`);
    mote.style.setProperty("--delay", `${(-Math.random() * 8).toFixed(1)}s`);
    mote.style.setProperty("--mx", `${((Math.random() - 0.5) * 40).toFixed(0)}px`);
    return mote;
  });
  el.shDust.replaceChildren(...motes);
}

function shHeart(size) {
  const heart = document.createElement("span");
  heart.className = Math.random() < 0.16 ? "sh-heart sh-heart--glass" : "sh-heart";
  heart.style.setProperty("--s", `${size.toFixed(1)}px`);
  heart.style.setProperty("--c", SH_HEART_COLORS[Math.floor(Math.random() * SH_HEART_COLORS.length)]);
  heart.style.setProperty("--sway", `${(1.3 + Math.random() * 1.5).toFixed(2)}s`);
  heart.style.setProperty("--dx", `${(4 + Math.random() * 12).toFixed(1)}px`);
  heart.innerHTML = '<span><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart"/></svg></span>';
  return heart;
}

// Hearts flying out from one point
function shBurst(x, y, count, { reach = 1, upward = false } = {}) {
  const span = Math.min(window.innerWidth, window.innerHeight);
  for (let i = 0; i < count; i += 1) {
    const size = 14 + Math.random() * (upward ? 16 : 34);
    const angle = upward ? -Math.PI / 2 + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2;
    const distance = span * reach * (0.2 + Math.random() * 0.45);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const turn = (Math.random() - 0.5) * 70;
    const heart = shHeart(size);
    heart.style.left = `${(x - size / 2).toFixed(1)}px`;
    heart.style.top = `${(y - size / 2).toFixed(1)}px`;
    el.shHearts.append(heart);
    const animation = shAnimate(heart, [
      { transform: "translate3d(0, 0, 0) scale(0.2) rotate(0deg)", opacity: 0 },
      { transform: `translate3d(${dx * 0.75}px, ${dy * 0.75}px, 0) scale(1.1) rotate(${turn}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate3d(${dx}px, ${dy + span * 0.08}px, 0) scale(0.85) rotate(${turn * 1.4}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 800, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "none" });
    animation.finished.then(() => heart.remove(), () => heart.remove());
  }
}

// One heart rising like a bubble; prefill starts it somewhere along the way
function shRise(prefill = false) {
  if (el.shHearts.childElementCount > 80) return null;
  const vh = window.innerHeight;
  const size = 12 + Math.pow(Math.random(), 1.8) * 42;
  const heart = shHeart(size);
  heart.style.left = `${(Math.random() * window.innerWidth - size / 2).toFixed(1)}px`;
  heart.style.top = `${vh + 12}px`;
  el.shHearts.append(heart);
  const travel = vh + size + 60;
  const duration = 6000 + Math.random() * 5000;
  const animation = shAnimate(heart, [
    { transform: "translate3d(0, 0, 0) scale(0.7)", opacity: 0 },
    { transform: `translate3d(0, ${-travel * 0.08}px, 0) scale(0.8)`, opacity: 0.95, offset: 0.08 },
    { transform: `translate3d(0, ${-travel * 0.85}px, 0) scale(1)`, opacity: 0.9, offset: 0.85 },
    { transform: `translate3d(0, ${-travel}px, 0) scale(1.05)`, opacity: 0 },
  ], { duration, easing: "linear", fill: "none" });
  if (prefill) animation.currentTime = duration * (0.1 + Math.random() * 0.75);
  animation.finished.then(() => heart.remove(), () => heart.remove());
  return animation;
}

function shStartHearts(token) {
  for (let i = 0; i < 44; i += 1) shRise(true); // the screen fills at once…
  let gap = 90;
  const next = () => {
    if (token !== sh.token) return;
    shRise();
    gap = Math.min(340, gap + 7); // …then calms down so the words stay readable
    shLater(next, gap);
  };
  shLater(next, gap);
}

// Little hearts popping up from the plush otter's head now and then
function shPlushHearts(token) {
  const pop = () => {
    if (token !== sh.token) return;
    const rect = el.shPlush.getBoundingClientRect();
    shBurst(rect.left + rect.width * (0.35 + Math.random() * 0.3), rect.top + rect.height * 0.1, 3, { reach: 0.3, upward: true });
    shLater(pop, 2000 + Math.random() * 1400);
  };
  shLater(pop, 1600);
}

// Sea otters (from our photo) drifting across the water in rows, nearer ones bigger
function shFillSea() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rows = vh > 700 ? 7 : 6;
  const perRow = Math.max(1, Math.round(vw / 620));
  const base = Math.max(56, Math.min(120, Math.min(vw, vh) * 0.2));
  const top = el.shMessage.offsetTop + el.shMessage.offsetHeight + base * 0.45; // below the message card
  const bottom = vh - base * 0.9;
  let count = 0;
  for (let row = 0; row < rows; row += 1) {
    const depth = (row + 0.5) / rows;
    const size = base * (0.7 + depth * 0.62);
    const y = top + depth * Math.max(0, bottom - top) + (Math.random() - 0.5) * base * 0.3;
    const direction = row % 2 === 0 ? 1 : -1;
    const speed = (18 + Math.random() * 16) * (0.8 + depth * 0.5);
    for (let n = 0; n < perRow; n += 1) {
      shSwimmer({
        y,
        size,
        direction,
        speed,
        pair: (row === 1 || row === 4) && n === 0, // two of them holding hands
        progress: (n + Math.random() * 0.6) / perRow,
        which: count % SHNOTTER_SEA.length,
        delay: 120 + count * 70,
      });
      count += 1;
    }
  }
}

function shSwimmer({ y, size, direction, speed, pair, progress, which, delay }) {
  const vw = window.innerWidth;
  const otters = pair ? [SHNOTTER_SEA[0], SHNOTTER_SEA[1]] : [SHNOTTER_SEA[which]];
  const width = otters.reduce((sum, otter) => sum + size * otter.ratio, 0) * (pair ? 0.9 : 1);

  const swim = document.createElement("div");
  swim.className = "sh-swim";
  swim.style.top = `${(y - size / 2).toFixed(1)}px`;
  swim.style.zIndex = String(Math.round(y));
  swim.style.setProperty("--size", `${size.toFixed(1)}px`);
  const pop = document.createElement("div");
  pop.className = "sh-swim-pop";
  otters.forEach((otter) => {
    const bob = document.createElement("div");
    bob.className = "sh-swim-bob";
    bob.style.setProperty("--bob", `${(3 + Math.random() * 1.8).toFixed(2)}s`);
    bob.style.setProperty("--delay", `${(-Math.random() * 3).toFixed(2)}s`);
    bob.style.setProperty("--tilt-a", `${(-3 - Math.random() * 4).toFixed(1)}deg`);
    bob.style.setProperty("--tilt-b", `${(3 + Math.random() * 4).toFixed(1)}deg`);
    const image = new Image();
    image.alt = "";
    image.draggable = false;
    image.src = otter.src;
    if (!pair && Math.random() < 0.5) image.classList.add("is-flipped");
    bob.append(image);
    pop.append(bob);
  });
  swim.append(pop);
  el.shSea.append(swim);

  const from = direction > 0 ? -width - 30 : vw + 30;
  const to = direction > 0 ? vw + 30 : -width - 30;
  const duration = (Math.abs(to - from) / speed) * 1000;
  const drift = shAnimate(swim, [{ transform: `translate3d(${from.toFixed(1)}px, 0, 0)` }, { transform: `translate3d(${to.toFixed(1)}px, 0, 0)` }], {
    duration, iterations: Infinity, easing: "linear", fill: "none",
  });
  drift.currentTime = duration * progress;
  shAnimate(pop, [
    { transform: "scale(0)", opacity: 0 },
    { transform: "scale(1.15)", opacity: 1, offset: 0.6 },
    { transform: "scale(1)", opacity: 1 },
  ], { duration: 750, delay, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)", fill: "backwards" });
}

// Where the plush otter floats at the end: centred, just above the return button
function shLandingPose() {
  const height = el.shOtter.offsetHeight;
  const scale = Math.min(0.7, (window.innerHeight * 0.3) / height);
  const restBottom = parseFloat(getComputedStyle(el.shOtter).bottom) || 0;
  const buttonTop = (parseFloat(getComputedStyle(el.shReturn).bottom) || 22) + el.shReturn.offsetHeight + 18;
  return { y: restBottom - buttonTop, scale };
}

function shRevealReturn() {
  el.shReturn.classList.add("is-shown");
  shAnimate(el.shReturn, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  el.shReturn.focus({ preventScroll: true });
}

async function shShow(token) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = el.shOtter.offsetWidth;
  const far = 0.5;
  const near = 0.58;
  const poolY = -vh * 0.16; // standing further away = higher up the screen
  const hiddenX = -vw / 2 - width * far * 0.62;
  const peekX = -vw / 2 + width * far * 0.1;
  const smooth = "cubic-bezier(0.45, 0, 0.25, 1)";

  // 1. The lights go out, with a flicker
  el.shnotter.classList.add("is-cinema");
  await shPlay(token, [[el.shDark, [
    { opacity: 0 }, { opacity: 0.6, offset: 0.3 }, { opacity: 0.25, offset: 0.4 },
    { opacity: 0.92, offset: 0.66 }, { opacity: 0.7, offset: 0.73 }, { opacity: 1 },
  ], { duration: 950, easing: "linear" }]]);

  // 2. Something blinks in the dark
  await shWait(token, 250);
  shCaption("psst…");
  await shPlay(token, [[el.shEyes, [
    { opacity: 0, transform: "translateX(0) scaleY(1)" },
    { opacity: 1, transform: "translateX(0) scaleY(1)", offset: 0.16 },
    { opacity: 1, transform: "translateX(0) scaleY(0.1)", offset: 0.3 },
    { opacity: 1, transform: "translateX(0) scaleY(1)", offset: 0.38 },
    { opacity: 1, transform: "translateX(14px) scaleY(1)", offset: 0.6 },
    { opacity: 1, transform: "translateX(14px) scaleY(0.1)", offset: 0.7 },
    { opacity: 1, transform: "translateX(14px) scaleY(1)", offset: 0.78 },
    { opacity: 0, transform: "translateX(-10px) scaleY(1)" },
  ], { duration: 1700, easing: "ease-in-out" }]]);
  shCaption("");

  // 3. A spotlight flickers on
  shAnimate(el.shBeam, [
    { opacity: 0 }, { opacity: 0.8, offset: 0.2 }, { opacity: 0.15, offset: 0.32 }, { opacity: 1, offset: 0.55 }, { opacity: 1 },
  ], { duration: 800, easing: "linear" });
  await shWait(token, 650);

  // 4. It peeks in from the side… and ducks away again
  el.shShade.style.opacity = "0.82";
  el.shOtter.style.transform = shPose(hiddenX, poolY, far);
  el.shOtter.style.opacity = "1";
  shCaption("did you hear that?");
  await shPlay(token, [[el.shOtter, [{ transform: shPose(hiddenX, poolY, far) }, { transform: shPose(peekX, poolY, far, 14) }], {
    duration: 650, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)",
  }]]);
  await shWait(token, 480);
  await shPlay(token, [[el.shOtter, [{ transform: shPose(peekX, poolY, far, 14) }, { transform: shPose(hiddenX, poolY, far, 4) }], {
    duration: 230, easing: "cubic-bezier(0.6, 0, 0.9, 0.5)",
  }]]);
  shCaption("don’t move…");
  await shWait(token, 800);
  shCaption("");

  // 5. Tiptoes into the light, with a sneaky pause halfway
  const midX = -vw * 0.22;
  el.shBody.classList.add("is-tiptoe");
  await shPlay(token, [
    [el.shOtter, [
      { transform: shPose(hiddenX, poolY, far), easing: smooth },
      { transform: shPose(midX, poolY, far + 0.03), offset: 0.42 },
      { transform: shPose(midX, poolY, far + 0.03), offset: 0.56, easing: smooth },
      { transform: shPose(0, poolY, near) },
    ], { duration: 2500 }],
    [el.shShade, [{ opacity: 0.82 }, { opacity: 0.74, offset: 0.42 }, { opacity: 0.6, offset: 0.56 }, { opacity: 0.06 }], {
      duration: 2500, easing: "ease-in-out",
    }],
  ]);
  el.shBody.classList.remove("is-tiptoe");

  // 6. Looks around suspiciously
  await shPlay(token, [[el.shBody, [
    { transform: "rotate(0deg)" }, { transform: "rotate(-8deg)", offset: 0.28 }, { transform: "rotate(-8deg)", offset: 0.4 },
    { transform: "rotate(8deg)", offset: 0.7 }, { transform: "rotate(8deg)", offset: 0.8 }, { transform: "rotate(0deg)" },
  ], { duration: 1150, easing: "ease-in-out" }]]);

  // 7. Crouches… and creeps toward you
  await shPlay(token, [[el.shBody, [{ transform: "scale(1, 1)" }, { transform: "scale(1.05, 0.93)", offset: 0.6 }, { transform: "scale(1, 1)" }], {
    duration: 360, easing: "ease-out",
  }]]);
  el.shBody.style.removeProperty("transform");
  el.shBody.classList.add("is-tiptoe");
  shAnimate(el.shBeam, [{ opacity: 1 }, { opacity: 0.35 }], { duration: 1300, easing: "ease-in" });
  await shPlay(token, [[el.shOtter, [{ transform: shPose(0, poolY, near) }, { transform: shPose(0, 0, 1) }], {
    duration: 1350, easing: "cubic-bezier(0.5, 0, 0.3, 1)",
  }]]);
  el.shBody.classList.remove("is-tiptoe");

  // 8. Stares at you for a moment…
  await shPlay(token, [[el.shZoom, [{ transform: "scale(1)" }, { transform: "scale(1.035)", offset: 0.5 }, { transform: "scale(1)" }], {
    duration: 750, easing: "ease-in-out",
  }]]);

  // 9. …and boops the screen
  const boop = shAnimate(el.shZoom, [{ transform: "scale(1)" }, { transform: "scale(3)" }], { duration: 420, easing: "cubic-bezier(0.7, 0, 0.95, 0.45)" });
  await shWait(token, 310);
  await shLove(token, boop);
}

async function shLove(token, boop) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  sh.love = true;

  // A warm flash hides the change of scene
  shAnimate(el.shFlash, [{ opacity: 0 }, { opacity: 0.96, offset: 0.16 }, { opacity: 0 }], { duration: 950, easing: "ease-out" });
  await shWait(token, 150);

  // The ocean is switched on underneath the darkness first, so the site never shows through
  el.shnotter.classList.remove("is-cinema");
  el.shOcean.style.opacity = "1";
  el.shSea.style.opacity = "1";
  shAnimate(el.shDark, [{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: "ease-out" });
  shAnimate(el.shBeam, [{ opacity: 0.35 }, { opacity: 0 }], { duration: 300 });
  el.shShade.style.opacity = "0";
  if (boop) boop.cancel();

  // The plush otter lands on the water and floats there, happy
  const { y, scale } = shLandingPose();
  el.shOtter.classList.add("is-afloat");
  el.shBody.classList.add("is-floating");
  shAnimate(el.shOtter, [
    { transform: shPose(0, y, scale * 0.4) },
    { transform: shPose(0, y, scale * 1.14), offset: 0.55 },
    { transform: shPose(0, y, scale * 0.95), offset: 0.8 },
    { transform: shPose(0, y, scale) },
  ], { duration: 950, easing: "ease-out" });

  shBurst(vw / 2, vh * 0.42, 38);
  shFillSea();
  shStartHearts(token);
  shPlushHearts(token);

  await shWait(token, 1300);
  el.shMessage.classList.add("is-shown");
  shAnimate(el.shMessage, [{ opacity: 0, transform: "translateY(-14px) scale(0.97)" }, { opacity: 1, transform: "none" }], {
    duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  await shWait(token, 2100);
  shRevealReturn();
}

// Same ending without any movement, for people who have reduced motion switched on
function shStill() {
  sh.love = true;
  const { y, scale } = shLandingPose();
  el.shOcean.style.opacity = "1";
  el.shSea.style.opacity = "1";
  el.shShade.style.opacity = "0";
  el.shOtter.style.opacity = "1";
  el.shOtter.style.transform = shPose(0, y, scale);
  shFillSea();
  for (let i = 0; i < 26; i += 1) shRise(true);
  sh.anims.forEach((animation) => animation.pause());
  el.shMessage.classList.add("is-shown");
  el.shMessage.style.opacity = "1";
  el.shReturn.classList.add("is-shown");
  el.shReturn.style.opacity = "1";
  el.shReturn.focus({ preventScroll: true });
}

function shReset() {
  sh.timers.forEach((timer) => clearTimeout(timer));
  sh.timers.clear();
  sh.anims.forEach((animation) => animation.cancel());
  sh.anims.clear();
  sh.love = false;
  el.shHearts.replaceChildren();
  el.shSea.replaceChildren();
  [el.shOcean, el.shSea, el.shDark, el.shBeam, el.shEyes, el.shOtter, el.shZoom, el.shBody, el.shShade, el.shFlash, el.shCaption, el.shMessage, el.shReturn]
    .forEach((node) => {
      node.style.removeProperty("transform");
      node.style.removeProperty("opacity");
    });
  el.shnotter.classList.remove("is-cinema");
  el.shOtter.classList.remove("is-afloat");
  el.shBody.classList.remove("is-tiptoe", "is-floating");
  el.shMessage.classList.remove("is-shown");
  el.shReturn.classList.remove("is-shown");
  el.shCaption.textContent = "";
}

async function openShnotter() {
  if (sh.open || typeof el.shnotter.showModal !== "function") return;
  closeMenus();
  sh.open = true;
  sh.opener = document.activeElement;
  const token = ++sh.token;
  shReset();
  if (!el.shPlush.getAttribute("src")) {
    el.shPlush.src = SHNOTTER_PLUSH;
    el.shShade.style.webkitMaskImage = `url("${SHNOTTER_PLUSH}")`;
    el.shShade.style.maskImage = `url("${SHNOTTER_PLUSH}")`;
  }
  el.shnotter.showModal();
  document.documentElement.classList.add("has-modal");
  shMotes();
  try {
    history.pushState({ shnotter: true }, "");
    sh.pushedHistory = true; // so a phone's back gesture closes the show instead of leaving the site
  } catch (_) {
    sh.pushedHistory = false;
  }

  try {
    const images = [el.shPlush, ...SHNOTTER_SEA.map((otter) => Object.assign(new Image(), { src: otter.src }))];
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    shCheck(token);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) shStill();
    else await shShow(token);
  } catch (error) {
    if (error instanceof ShnotterStopped) return;
    console.error(error);
    if (token === sh.token) shRevealReturn(); // never leave anyone stuck in the dark
  }
}

async function closeShnotter() {
  if (!sh.open || sh.closing) return;
  sh.closing = true;
  sh.token += 1;
  sh.love = false;
  if (sh.pushedHistory) {
    sh.pushedHistory = false;
    history.back();
  }
  const fade = el.shnotter.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, easing: "ease-in", fill: "forwards" });
  await fade.finished.catch(() => {});
  shReset();
  el.shnotter.close();
  fade.cancel();
  sh.open = false;
  sh.closing = false;
  if (!$("dialog[open]")) document.documentElement.classList.remove("has-modal");
  const back = sh.opener && sh.opener.isConnected && sh.opener !== document.body ? sh.opener : el.shnotterBtn;
  back.focus({ preventScroll: true });
}

function setupShnotter() {
  el.shnotterBtn.addEventListener("click", openShnotter);
  el.shReturn.addEventListener("click", closeShnotter);
  el.shnotter.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeShnotter();
  });
  // Tap anywhere during the ending for more hearts
  el.shnotter.addEventListener("pointerdown", (event) => {
    if (!sh.love || sh.closing || event.target.closest("button")) return;
    shBurst(event.clientX, event.clientY, 9, { reach: 0.32 });
  });
  window.addEventListener("popstate", () => {
    if (!sh.open) return;
    sh.pushedHistory = false;
    closeShnotter();
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
  setupShnotter();
  if (storage.get(KEYS.unlocked, session()) === "1") afterUnlock();
  else el.lock.hidden = false;
  setTimeout(setupAndroidManifest, 1500);
}

boot();

/* ---------- Shnotter photos ---------- */

// The otter photos are built into this file as text, so the whole site stays at three files.
const SHNOTTER_PLUSH = "data:image/webp;base64,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";

const SHNOTTER_SEA = [
  { ratio: 0.8402, src: "data:image/webp;base64,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" },
  { ratio: 0.7236, src: "data:image/webp;base64,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" },
  { ratio: 0.9797, src: "data:image/webp;base64,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" },
];
