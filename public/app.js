"use strict";
/* Hestia Chat — frontend chat AI ringan, backend: Hestia Bridge (OpenAI-compatible). */

var LS_SETTINGS = "hestia-chat-settings";
var LS_CHATS = "hestia-chat-chats";
var DEFAULT_BASE = "https://hestia-bridge-production.up.railway.app/v1";

function $(id) { return document.getElementById(id); }

function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}");
    return {
      baseUrl: (s.baseUrl || DEFAULT_BASE).replace(/\/+$/, ""),
      apiKey: s.apiKey || "",
      systemPrompt: s.systemPrompt || ""
    };
  } catch (e) { return { baseUrl: DEFAULT_BASE, apiKey: "", systemPrompt: "" }; }
}
function saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

function loadChats() {
  try { return JSON.parse(localStorage.getItem(LS_CHATS) || "[]"); }
  catch (e) { return []; }
}
function saveChats(c) { localStorage.setItem(LS_CHATS, JSON.stringify(c)); }

var settings = loadSettings();
var chats = loadChats();
var activeId = chats.length ? chats[0].id : null;
var models = [];
var streaming = false;

function uid() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function activeChat() { return chats.find(function (c) { return c.id === activeId; }) || null; }

/* ---------- mini markdown ---------- */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function md(src) {
  var codeBlocks = [];
  // 1. code blocks ```lang ... ```
  var text = src.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, function (m, lang, code) {
    codeBlocks.push({ lang: lang || "code", code: code.replace(/\n$/, "") });
    return "\u0000" + (codeBlocks.length - 1) + "\u0000";
  });
  text = esc(text);
  // 2. inline code
  text = text.replace(/`([^`\n]+)`/g, "<code class=\"inline\">$1</code>");
  // 3. bold / italic
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // 4. links
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>");
  // 5. lists + paragraphs
  var lines = text.split("\n"), out = [], inList = false;
  lines.forEach(function (ln) {
    var m = ln.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push("<li>" + m[1] + "</li>");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(ln.trim() === "" ? "" : "<p>" + ln + "</p>");
    }
  });
  if (inList) out.push("</ul>");
  text = out.join("\n");
  // 6. restore code blocks
  text = text.replace(/\u0000(\d+)\u0000/g, function (m, i) {
    var b = codeBlocks[+i];
    return "<pre><div class=\"code-head\"><span>" + esc(b.lang) + "</span>" +
      "<button data-code-copy=\"" + i + "\">Salin</button></div>" +
      "<code>" + esc(b.code) + "</code></pre>";
  });
  window.__codeBlocks = codeBlocks;
  return text;
}

/* ---------- bridge API ---------- */
async function bridgeFetch(path, opts) {
  opts = opts || {};
  var headers = Object.assign({}, opts.headers || {}, {
    "Authorization": "Bearer " + settings.apiKey,
    "Content-Type": "application/json"
  });
  var res = await fetch(settings.baseUrl + path, Object.assign({}, opts, { headers: headers }));
  if (!res.ok) {
    var t = "";
    try { t = await res.text(); } catch (e) {}
    throw new Error("HTTP " + res.status + (t ? " — " + t.slice(0, 160) : ""));
  }
  return res;
}

async function loadModels() {
  var picker = $("model-picker");
  if (!settings.apiKey) {
    picker.innerHTML = "<option value=\"\">Isi API key dulu</option>";
    return;
  }
  picker.innerHTML = "<option value=\"\">Memuat model…</option>";
  try {
    var res = await bridgeFetch("/v1/models");
    var data = await res.json();
    models = (data.data || []).map(function (m) { return m.id; }).filter(Boolean);
    if (!models.length) throw new Error("daftar model kosong");
    picker.innerHTML = models.map(function (m) {
      return "<option value=\"" + esc(m) + "\">" + esc(m) + "</option>";
    }).join("");
    var chat = activeChat();
    if (chat && chat.model && models.indexOf(chat.model) >= 0) picker.value = chat.model;
  } catch (e) {
    picker.innerHTML = "<option value=\"\">Gagal memuat model</option>";
    showStatus("Gagal memuat model: " + e.message, false);
  }
}

async function streamChat(model, messages, onToken) {
  var res = await bridgeFetch("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model: model, messages: messages, stream: true })
  });
  var reader = res.body.getReader();
  var decoder = new TextDecoder();
  var buf = "", full = "";
  for (;;) {
    var r = await reader.read();
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
    var parts = buf.split("\n");
    buf = parts.pop();
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].trim();
      if (line.indexOf("data:") !== 0) continue;
      var payload = line.slice(5).trim();
      if (payload === "[DONE]") return full;
      try {
        var j = JSON.parse(payload);
        var delta = (((j.choices || [])[0] || {}).delta || {}).content || "";
        if (delta) { full += delta; onToken(full); }
      } catch (e) { /* abaikan chunk rusak */ }
    }
  }
  return full;
}

/* ---------- render ---------- */
function copyIcon() {
  return "<svg viewBox=\"0 0 24 24\" width=\"12\" height=\"12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><rect x=\"9\" y=\"9\" width=\"13\" height=\"13\" rx=\"2\"/><path d=\"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1\"/></svg>";
}
function renderMessages() {
  var box = $("messages");
  var chat = activeChat();
  box.innerHTML = "";
  var hasKey = !!settings.apiKey;
  $("empty-state").style.display = (!chat || !chat.messages.length) && !hasKey ? "" : "none";
  $("composer").hidden = !hasKey;
  if (!chat) return;
  chat.messages.forEach(function (m, idx) {
    if (m.role === "system") return;
    var wrap = document.createElement("div");
    wrap.className = "msg " + m.role;
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = m.role === "user" ? esc(m.content).replace(/\n/g, "<br>") : md(m.content);
    wrap.appendChild(bubble);
    var acts = document.createElement("div");
    acts.className = "msg-actions";
    var btn = document.createElement("button");
    btn.className = "mini-btn";
    btn.innerHTML = copyIcon() + "<span>Salin</span>";
    btn.onclick = function () {
      navigator.clipboard.writeText(m.content).then(function () {
        btn.querySelector("span").textContent = "Tersalin";
        setTimeout(function () { btn.querySelector("span").textContent = "Salin"; }, 1200);
      });
    };
    acts.appendChild(btn);
    wrap.appendChild(acts);
    box.appendChild(wrap);
  });
  // tombol salin code block
  box.querySelectorAll("[data-code-copy]").forEach(function (b) {
    b.onclick = function () {
      var blk = (window.__codeBlocks || [])[+b.getAttribute("data-code-copy")];
      if (blk) navigator.clipboard.writeText(blk.code).then(function () {
        b.textContent = "Tersalin";
        setTimeout(function () { b.textContent = "Salin"; }, 1200);
      });
    };
  });
  $("chat-area").scrollTop = $("chat-area").scrollHeight;
}

function renderChatList() {
  var list = $("chat-list");
  list.innerHTML = "";
  if (!chats.length) {
    list.innerHTML = "<div class=\"empty-hint\">Belum ada riwayat.</div>";
    return;
  }
  chats.forEach(function (c) {
    var b = document.createElement("button");
    b.className = "chat-item" + (c.id === activeId ? " active" : "");
    var t = document.createElement("span");
    t.className = "title";
    t.textContent = c.title || "Chat baru";
    var del = document.createElement("span");
    del.className = "del";
    del.setAttribute("role", "button");
    del.innerHTML = "<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"><line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg>";
    del.onclick = function (e) {
      e.stopPropagation();
      chats = chats.filter(function (x) { return x.id !== c.id; });
      if (activeId === c.id) activeId = chats.length ? chats[0].id : null;
      saveChats(chats);
      refresh();
    };
    b.appendChild(t); b.appendChild(del);
    b.onclick = function () { activeId = c.id; saveChats(chats); refresh(); closeDrawer(); };
    list.appendChild(b);
  });
}

function refresh() { renderChatList(); renderMessages(); }

function newChat() {
  var c = { id: uid(), title: "Chat baru", model: $("model-picker").value || models[0] || "", createdAt: Date.now(), messages: [] };
  chats.unshift(c);
  activeId = c.id;
  saveChats(chats);
  refresh();
  closeDrawer();
}

/* ---------- kirim ---------- */
function autoGrow() {
  var ta = $("input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
}

async function send() {
  if (streaming) return;
  var ta = $("input");
  var text = ta.value.trim();
  if (!text) return;
  var model = $("model-picker").value || models[0];
  if (!model) { showStatus("Pilih model dulu.", false); openSettings(); return; }
  var chat = activeChat();
  if (!chat) { newChat(); chat = activeChat(); }
  chat.model = model;
  chat.messages.push({ role: "user", content: text });
  if (chat.messages.filter(function (m) { return m.role !== "system"; }).length === 1) {
    chat.title = text.slice(0, 40) + (text.length > 40 ? "…" : "");
  }
  ta.value = ""; autoGrow();
  saveChats(chats);

  var apiMessages = [];
  if (settings.systemPrompt) apiMessages.push({ role: "system", content: settings.systemPrompt });
  chat.messages.forEach(function (m) { if (m.role !== "system") apiMessages.push({ role: m.role, content: m.content }); });

  // bubble AI sementara dengan indikator mengetik
  var box = $("messages");
  var wrap = document.createElement("div");
  wrap.className = "msg ai";
  var bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = "<span class=\"typing\"><span></span><span></span><span></span></span>";
  wrap.appendChild(bubble);
  box.appendChild(wrap);
  $("chat-area").scrollTop = $("chat-area").scrollHeight;

  streaming = true;
  $("btn-send").disabled = true;
  var aiMsg = { role: "assistant", content: "" };
  chat.messages.push(aiMsg);
  // Retry otomatis 2x jika stream gagal/terputus di tengah jalan
  var full = "";
  var lastErr = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        bubble.innerHTML = "<span class=\"typing\"><span></span><span></span><span></span></span>";
      }
      full = await streamChat(model, apiMessages, function (partial) {
        aiMsg.content = partial;
        bubble.innerHTML = md(partial);
        $("chat-area").scrollTop = $("chat-area").scrollHeight;
      });
      // anggap gagal jika stream selesai tapi konten kosong
      if (!full || !full.trim()) throw new Error("respons kosong dari bridge");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      // jeda singkat sebelum retry
      await new Promise(function (r) { setTimeout(r, 800); });
    }
  }
  try {
    if (lastErr) throw lastErr;
    aiMsg.content = full;
    bubble.innerHTML = md(full);
  } catch (e) {
    chat.messages.pop();
    var err = document.createElement("div");
    err.className = "error-note";
    err.textContent = "Gagal: " + e.message;
    wrap.appendChild(err);
  }
  streaming = false;
  $("btn-send").disabled = false;
  saveChats(chats);
  refresh();
}

/* ---------- drawer & settings ---------- */
function openDrawer() { $("drawer").classList.add("open"); $("drawer-backdrop").hidden = false; }
function closeDrawer() { $("drawer").classList.remove("open"); $("drawer-backdrop").hidden = true; }
function openSettings() {
  $("set-baseurl").value = settings.baseUrl;
  $("set-key").value = settings.apiKey;
  $("set-system").value = settings.systemPrompt;
  showStatus("", true);
  $("settings-modal").hidden = false;
}
function closeSettings() { $("settings-modal").hidden = true; }
function showStatus(msg, ok) {
  var el = $("settings-status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false;
  el.className = "status " + (ok ? "ok" : "err");
  el.textContent = msg;
}

async function testConnection(baseUrl, apiKey) {
  var res = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/models", {
    headers: { "Authorization": "Bearer " + apiKey }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  var data = await res.json();
  var n = (data.data || []).length;
  if (!n) throw new Error("tidak ada model dari bridge");
  return n;
}

/* ---------- events ---------- */
$("btn-menu").onclick = openDrawer;
$("btn-close-drawer").onclick = closeDrawer;
$("drawer-backdrop").onclick = closeDrawer;
$("btn-new").onclick = newChat;
$("btn-new-2").onclick = newChat;
$("btn-settings").onclick = function () { closeDrawer(); openSettings(); };
$("btn-open-settings").onclick = openSettings;
$("btn-close-settings").onclick = closeSettings;
$("settings-modal").addEventListener("click", function (e) {
  if (e.target === $("settings-modal")) closeSettings();
});
$("btn-clear").onclick = function () {
  if (!chats.length) return;
  if (confirm("Hapus semua riwayat chat?")) {
    chats = []; activeId = null; saveChats(chats); refresh(); closeDrawer();
  }
};
$("input").addEventListener("input", autoGrow);
$("input").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
$("btn-send").onclick = send;
$("model-picker").addEventListener("change", function () {
  var chat = activeChat();
  if (chat) { chat.model = $("model-picker").value; saveChats(chats); }
});
$("btn-test").onclick = async function () {
  showStatus("Mengetes koneksi…", true);
  try {
    var n = await testConnection($("set-baseurl").value.trim() || DEFAULT_BASE, $("set-key").value.trim());
    showStatus("Tersambung. " + n + " model tersedia.", true);
  } catch (e) {
    showStatus("Gagal: " + e.message, false);
  }
};
$("btn-save-settings").onclick = async function () {
  var s = {
    baseUrl: ($("set-baseurl").value.trim() || DEFAULT_BASE).replace(/\/+$/, ""),
    apiKey: $("set-key").value.trim(),
    systemPrompt: $("set-system").value.trim()
  };
  settings = s;
  saveSettings(s);
  closeSettings();
  await loadModels();
  refresh();
};

/* ---------- init ---------- */
(function init() {
  if (!settings.apiKey) openSettings();
  loadModels();
  refresh();
})();
