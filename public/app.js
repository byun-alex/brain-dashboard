// Brain Dashboard front-end

const el = (id) => document.getElementById(id);
const orb = el("orb");
let busy = false;
let activeProject = "";   // "" = everything
let sessionId = "";       // Claude session for memory; resets when context changes
let commands = [];        // slash-command list for autofill
let model = "";           // "" | opus | sonnet | haiku
let caveman = false;      // caveman style toggle

// running session totals
let sess = { msgs: 0, fresh: 0, cached: 0, out: 0, cost: 0 };

// persistent per-context chat history (survives close/reopen via localStorage)
let history = [];
const threadKey = (proj) => "brainChat:" + (proj || "_all");

function saveThread() {
  try {
    localStorage.setItem(threadKey(activeProject), JSON.stringify({
      sessionId, sess, history: history.slice(-100),
    }));
  } catch {}
}
function loadThread(proj) {
  history = [];
  el("chat").innerHTML = "";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(threadKey(proj)) || "null"); } catch {}
  if (saved && saved.history && saved.history.length) {
    sessionId = saved.sessionId || "";
    sess = saved.sess || { msgs: 0, fresh: 0, cached: 0, out: 0, cost: 0 };
    saved.history.forEach((m) => { history.push(m); renderMsg(m.text, m.who, m.stats); });
    updateSessionBar();
  } else {
    sessionId = "";
    resetSession();
    renderMsg("Standing by, Alax. Hit a button above, or just ask me anything.", "jarvis");
  }
}

// ---------- load vault data ----------
async function loadData() {
  try {
    const r = await fetch("/api/data");
    render(await r.json());
  } catch {
    el("greeting").textContent = "Couldn't read the vault";
  }
}

async function loadCommands() {
  try {
    commands = await (await fetch("/api/commands")).json();
  } catch { commands = []; }
}

function render(d) {
  el("date").textContent = d.date;
  el("greeting").textContent = `${d.greeting}, ${d.name}.`;

  // To Do
  const tl = el("todo-list");
  tl.innerHTML = "";
  el("todo-count").textContent = d.todos.length;
  if (!d.todos.length) {
    tl.innerHTML = `<li>Nothing open. Clear runway. ✦</li>`;
  } else {
    d.todos.slice(0, 12).forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escape(t.text)}<span class="sec">${escape(t.section)}</span></span>`;
      tl.appendChild(li);
    });
  }

  // Projects
  const pg = el("proj-grid");
  pg.innerHTML = "";
  el("proj-count").textContent = (d.projects || []).length;
  (d.projects || []).forEach((p) => {
    const div = document.createElement("div");
    div.className = "proj" + (p.name === activeProject ? " active" : "");
    div.innerHTML = `<span class="p-ic">${p.icon}</span>
      <span class="p-name">${escape(p.name)}</span>
      <span class="p-desc">${escape(p.desc)}</span>`;
    div.addEventListener("click", () => setProject(p.name === activeProject ? "" : p.name));
    pg.appendChild(div);
  });

  // Ideas
  const il = el("idea-list");
  il.innerHTML = "";
  el("idea-count").textContent = d.ideas.length;
  d.ideas.forEach((i) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span><span class="iname">${escape(i.name)}</span> · <span class="imodel">${escape(i.model)}</span></span>
      <span class="stage ${i.stage}">${escape(i.stage)}</span>`;
    il.appendChild(li);
  });
}

function escape(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// pick which project Jarvis works in; switching context starts a fresh memory
function setProject(name) {
  if (name === activeProject) return;
  saveThread();              // stash the current context's conversation
  activeProject = name;
  el("ctx").textContent = "context: " + (name || "everything");
  document.querySelectorAll(".proj").forEach((p) => {
    p.classList.toggle("active", p.querySelector(".p-name").textContent === name);
  });
  loadThread(name);          // restore (or start) this context's conversation
  addMsg(`Now in: ${name || "everything"}.`, "jarvis");
  if (term && !el("view-term").hidden) { /* terminal reconnect handled on tab */ }
}

// ---------- session stats ----------
function fmtTok(n) {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}
function resetSession() {
  sess = { msgs: 0, fresh: 0, cached: 0, out: 0, cost: 0 };
  el("session-bar").textContent = "new session · $0.000 so far";
}
function updateSessionBar() {
  // Lead with COST (the real bill). Cached tokens are shown muted — they're
  // billed at ~1/10th and dominate the raw count, so the raw count misleads.
  el("session-bar").innerHTML =
    `session · ${sess.msgs} msg${sess.msgs === 1 ? "" : "s"} · ` +
    `<b>$${sess.cost.toFixed(3)}</b> · ↓ ${fmtTok(sess.out)} out ` +
    `<span class="dim">(↑ ${fmtTok(sess.fresh)} new, ${fmtTok(sess.cached)} cached)</span>`;
}

// ---------- chat ----------
// renderMsg = draw only (used for transient bubbles like the typing indicator)
function renderMsg(text, who, stats) {
  const chat = el("chat");
  const div = document.createElement("div");
  div.className = `msg ${who}-msg`;
  let footer = "";
  if (stats) {
    const cached = stats.usage.cacheRead + stats.usage.cacheCreate;
    footer = `<div class="msg-stats">⏱ ${(stats.durationMs / 1000).toFixed(1)}s · ` +
      `<b>$${stats.costUsd.toFixed(3)}</b> · ↓ ${fmtTok(stats.usage.output)} out ` +
      `<span class="dim">(↑ ${fmtTok(stats.usage.input)} new, ${fmtTok(cached)} cached)</span></div>`;
  }
  div.innerHTML = `<div class="msg-body">${escape(text)}</div>${footer}`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}
const addMsg = renderMsg; // transient bubble
// commitMsg = draw + remember (saved to localStorage so it survives reopen)
function commitMsg(text, who, stats) {
  const node = renderMsg(text, who, stats);
  history.push({ text, who, stats: stats || null });
  saveThread();
  return node;
}

// churning indicator + live timer
const CHURN = ["Thinking", "Churning", "Pondering", "Noodling", "Cooking", "Brewing", "Computing", "Conjuring", "Percolating"];
let churnTimer = null, tickTimer = null, t0 = 0;
function startChurn(node) {
  t0 = Date.now();
  let i = 0;
  const word = CHURN[Math.floor(Math.random() * CHURN.length)];
  const set = () => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    node.querySelector(".msg-body").innerHTML =
      `<span class="spinner"></span> ${word}… <span class="elapsed">${secs}s</span>`;
    el("status").textContent = `${word.toLowerCase()}… ${secs}s`;
  };
  set();
  tickTimer = setInterval(set, 200);
}
function stopChurn() {
  clearInterval(tickTimer); clearInterval(churnTimer);
  el("status").textContent = "ready";
  el("status").classList.remove("busy");
}

async function runPrompt(prompt, label) {
  if (busy) return;
  busy = true;
  orb.classList.add("thinking");
  el("status").classList.add("busy");
  el("send").disabled = true;

  commitMsg(label || prompt, "you");
  const typing = addMsg("…", "jarvis");
  typing.classList.add("typing");
  startChurn(typing);

  try {
    const r = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, project: activeProject, sessionId, model, caveman }),
    });
    const d = await r.json();
    stopChurn();
    typing.remove();
    if (d.sessionId) sessionId = d.sessionId;   // remember the thread
    if (d.usage) {
      sess.msgs += 1;
      sess.fresh += d.usage.input;
      sess.cached += d.usage.cacheRead + d.usage.cacheCreate;
      sess.out += d.usage.output;
      sess.cost += d.costUsd || 0;
      updateSessionBar();
    }
    commitMsg(d.output, "jarvis", d.ok && d.usage ? d : null);
    loadData(); // panels may have changed
  } catch (e) {
    stopChurn();
    typing.remove();
    commitMsg("Something broke talking to Claude: " + e.message, "jarvis");
  } finally {
    busy = false;
    orb.classList.remove("thinking");
    el("send").disabled = false;
  }
}

// ---------- slash command autofill ----------
const menu = el("cmd-menu");
const input = el("input");
let menuItems = [], menuSel = -1;

function showMenu(filter) {
  const f = filter.toLowerCase();
  menuItems = commands.filter((c) => c.cmd.toLowerCase().startsWith(f)).slice(0, 8);
  if (!menuItems.length) { hideMenu(); return; }
  menuSel = 0;
  menu.innerHTML = menuItems
    .map((c, i) => `<div class="cmd-item ${i === 0 ? "sel" : ""}" data-i="${i}">
      <span class="cmd-name">${escape(c.cmd)}</span><span class="cmd-desc">${escape(c.desc)}</span></div>`)
    .join("");
  menu.hidden = false;
  menu.querySelectorAll(".cmd-item").forEach((it) => {
    it.addEventListener("click", () => pickCmd(+it.dataset.i));
  });
}
function hideMenu() { menu.hidden = true; menuSel = -1; menuItems = []; }
function moveSel(dir) {
  if (menu.hidden) return;
  menuSel = (menuSel + dir + menuItems.length) % menuItems.length;
  menu.querySelectorAll(".cmd-item").forEach((it, i) => it.classList.toggle("sel", i === menuSel));
}
function pickCmd(i) {
  if (i < 0 || i >= menuItems.length) return;
  input.value = menuItems[i].cmd + " ";
  hideMenu();
  input.focus();
}

input.addEventListener("input", () => {
  const v = input.value;
  if (v.startsWith("/") && !v.includes(" ")) showMenu(v);
  else hideMenu();
});
input.addEventListener("keydown", (e) => {
  if (menu.hidden) return;
  if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
  else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickCmd(menuSel); }
  else if (e.key === "Escape") hideMenu();
});

// quick buttons
document.querySelectorAll(".q-btn").forEach((b) => {
  b.addEventListener("click", () => {
    runPrompt(b.dataset.prompt, b.querySelector(".q-label").textContent);
  });
});

// composer submit
el("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!menu.hidden && menuSel >= 0) { pickCmd(menuSel); return; }
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  hideMenu();
  runPrompt(v);
});

// ---------- chat controls: model / caveman / clear ----------
el("model").addEventListener("change", (e) => { model = e.target.value; });

el("caveman-btn").addEventListener("click", () => {
  caveman = !caveman;
  const b = el("caveman-btn");
  b.textContent = "caveman: " + (caveman ? "on" : "off");
  b.classList.toggle("on", caveman);
});

el("clear-btn").addEventListener("click", () => {
  history = [];
  sessionId = "";
  resetSession();
  try { localStorage.removeItem(threadKey(activeProject)); } catch {}
  el("chat").innerHTML = "";
  renderMsg("Chat cleared. Fresh memory, Alax.", "jarvis");
});

// ---------- tabs: Jarvis chat <-> real Terminal ----------
let termReady = false, termAvailable = false;
document.querySelectorAll(".tab").forEach((t) => {
  t.addEventListener("click", () => {
    const which = t.dataset.tab;
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    el("view-chat").hidden = which !== "chat";
    el("view-term").hidden = which !== "term";
    if (which === "term") openTerminal();
  });
});

// ---------- embedded terminal (xterm.js + WebSocket -> real claude) ----------
let term = null, fit = null, ws = null, termProject = null;

async function checkFeatures() {
  try {
    const f = await (await fetch("/api/features")).json();
    termAvailable = !!f.terminal;
  } catch { termAvailable = false; }
  if (!termAvailable) {
    const tb = document.querySelector('.tab[data-tab="term"]');
    if (tb) { tb.disabled = true; tb.title = "terminal module not installed"; tb.style.opacity = 0.4; }
  }
}

function openTerminal() {
  if (!termAvailable) return;
  if (!window.Terminal) { el("term-hint").textContent = "xterm failed to load (need internet for the terminal)."; return; }

  // (re)create the terminal if first open or the project context changed
  if (!termReady) {
    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, Consolas, monospace",
      theme: { background: "#070b12", foreground: "#d7ecf6", cursor: "#38e1ff" },
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(el("term"));
    term.onData((d) => ws && ws.readyState === 1 && ws.send(JSON.stringify({ i: d })));
    window.addEventListener("resize", () => doFit());
    termReady = true;
  }
  if (termProject !== activeProject) { connectWs(); termProject = activeProject; }
  setTimeout(doFit, 60);
}

function doFit() {
  if (!fit || el("view-term").hidden) return;
  try {
    fit.fit();
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ r: [term.cols, term.rows] }));
  } catch {}
}

function connectWs() {
  if (ws) { try { ws.close(); } catch {} }
  term.reset();
  const q = activeProject ? "?project=" + encodeURIComponent(activeProject) : "";
  ws = new WebSocket(`ws://${location.host}/terminal${q}`);
  ws.onmessage = (e) => term.write(e.data);
  ws.onopen = () => setTimeout(doFit, 80);
  ws.onclose = () => term.write("\r\n\x1b[90m[session ended — press restart]\x1b[0m\r\n");
}

el("term-reconnect").addEventListener("click", () => { termProject = activeProject; connectWs(); setTimeout(doFit, 80); });

loadData();
loadCommands();
checkFeatures();
loadThread(activeProject); // restore last conversation for this context
