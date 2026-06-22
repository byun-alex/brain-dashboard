// Brain Dashboard — zero-dependency local server (MASTER home base)
// Sits at the top of "Claude stuff", sees every project, runs Claude commands.
// Localhost only — http://127.0.0.1:4317 — never exposed to the internet.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Optional native bits for the embedded real-terminal pane.
// If they're missing the dashboard still runs — just without the Terminal tab.
let pty = null, WebSocketServer = null;
try {
  pty = require("@homebridge/node-pty-prebuilt-multiarch");
  WebSocketServer = require("ws").WebSocketServer;
} catch { /* terminal pane disabled */ }

// Known model ids for the model dropdown.
const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
};

const PORT = 4317;
const PUBLIC = path.join(__dirname, "public");
const DASH = __dirname;                    // the Brain Dashboard folder
const ROOT = path.dirname(__dirname);      // "Claude stuff" — holds all projects
const VAULT = path.join(ROOT, "2nd brain cowork"); // where todos + ideas live

// Friendly labels/icons for known projects. Unknown folders still show up.
const PROJECT_META = {
  "2nd brain cowork": { icon: "🧠", desc: "Business idea blueprints" },
  "Content Factory": { icon: "🎬", desc: "Content production" },
  "Path to Claude God": { icon: "🚀", desc: "Mastering Claude" },
  "Football": { icon: "🏈", desc: "Football project" },
  "Skills": { icon: "🛠️", desc: "Custom skills" },
  "Second brain": { icon: "📓", desc: "Older notes" },
  "Beginning Claude": { icon: "🌱", desc: "Early Claude work" },
  "youtube-niche-automation": { icon: "📺", desc: "YouTube automation" },
};
// Folders to never show as projects.
const SKIP = new Set(["Brain Dashboard", "node_modules", "output"]);

// ---------- vault reading ----------

function safeRead(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}

function parseTodos() {
  const md = safeRead(path.join(VAULT, "00 - Assistant", "To Do.md"));
  const items = [];
  let section = "";
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)/);
    if (h) section = h[1].replace(/[#*_`]/g, "").trim();
    const todo = line.match(/^\s*-\s*\[ \]\s+(.*)/);
    if (todo) {
      let text = todo[1].replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/[*_`]/g, "").trim();
      if (text && !/^_.*_$/.test(text)) items.push({ text, section });
    }
  }
  return items;
}

function parseIdeas() {
  const md = safeRead(path.join(VAULT, "01 - Ideas", "Ideas Hub.md"));
  const rows = [];
  for (const line of md.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 6) continue;
    const m = cells[1].match(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/);
    if (!m) continue;
    rows.push({ name: m[1], model: cells[2], stage: cells[4].toLowerCase(), notes: cells[5] });
  }
  return rows;
}

function listProjects() {
  let out = [];
  try {
    for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith(".") || SKIP.has(d.name)) continue;
      const meta = PROJECT_META[d.name] || { icon: "📁", desc: "" };
      out.push({ name: d.name, icon: meta.icon, desc: meta.desc });
    }
  } catch {}
  return out;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function buildData() {
  return {
    greeting: greeting(),
    name: "Alax",
    date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    todos: parseTodos(),
    ideas: parseIdeas(),
    projects: listProjects(),
  };
}

// ---------- slash commands (for the autofill menu) ----------
// Curated built-ins + whatever skills live in ~/.claude/skills.
const BUILTIN_COMMANDS = [
  { cmd: "/catchup", desc: "Brief me on where I left off" },
  { cmd: "/wrapup", desc: "Save a session handoff to the log" },
  { cmd: "/code-review", desc: "Review the current diff for bugs" },
  { cmd: "/review", desc: "Review a pull request" },
  { cmd: "/security-review", desc: "Security review of pending changes" },
  { cmd: "/simplify", desc: "Clean up / simplify changed code" },
  { cmd: "/verify", desc: "Verify a change actually works" },
  { cmd: "/run", desc: "Launch and drive the project's app" },
  { cmd: "/init", desc: "Generate a CLAUDE.md for a project" },
  { cmd: "/find-skills", desc: "Discover and install new skills" },
];

function listCommands() {
  const map = new Map(BUILTIN_COMMANDS.map((c) => [c.cmd, c]));
  // pull personal skills off disk so the list stays fresh
  try {
    const skillsDir = path.join(require("os").homedir(), ".claude", "skills");
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const cmd = "/" + d.name;
      if (!map.has(cmd)) map.set(cmd, { cmd, desc: "skill" });
    }
  } catch {}
  return [...map.values()];
}

// ---------- run a Claude command ----------
// cwd decides which CLAUDE.md rules load:
//   no project  -> Brain Dashboard folder (loads the Jarvis persona CLAUDE.md)
//   a project   -> that project's folder (loads its own rules, focused work)
// sessionId (if passed) resumes the prior conversation -> Jarvis remembers.
function runClaude(prompt, project, sessionId, model, caveman, res) {
  let cwd = DASH;
  if (project) {
    const candidate = path.join(ROOT, project);
    if (candidate.startsWith(ROOT) && fs.existsSync(candidate)) cwd = candidate;
  }
  const args = ["-p", "--output-format", "json"];
  if (sessionId) args.push("--resume", sessionId);
  if (model && MODELS[model]) args.push("--model", MODELS[model]);
  // caveman toggle: deterministic style prefix (works regardless of plugins)
  const finalPrompt = caveman
    ? "Respond in caveman style: terse, drop articles/filler/pleasantries, fragments OK, keep full technical accuracy.\n\n" + prompt
    : prompt;
  const child = spawn("claude", args, { cwd, shell: true });

  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.on("close", () => {
    let payload;
    try {
      const j = JSON.parse(out);
      const u = j.usage || {};
      payload = {
        ok: !j.is_error,
        output: (j.result || "").trim() || "(no output)",
        sessionId: j.session_id || sessionId || "",
        durationMs: j.duration_ms || 0,
        costUsd: j.total_cost_usd || 0,
        usage: {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          cacheCreate: u.cache_creation_input_tokens || 0,
        },
      };
    } catch {
      payload = { ok: false, output: (err.trim() || out.trim() || "(no output)"), sessionId };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  child.on("error", (e) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, output: "Could not start Claude: " + e.message }));
  });

  // feed the prompt over stdin so spaces/quotes can't break the command
  child.stdin.write(finalPrompt);
  child.stdin.end();
}

// ---------- static serving ----------
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
function serveStatic(res, file) {
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) return res.writeHead(403).end();
  fs.readFile(full, (e, data) => {
    if (e) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "text/plain" });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  if (url === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(buildData()));
  }

  if (url === "/api/commands") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(listCommands()));
  }

  if (url === "/api/features") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ terminal: !!(pty && WebSocketServer) }));
  }

  if (url === "/api/run" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let prompt = "", project = "", sessionId = "", model = "", caveman = false;
      try { const j = JSON.parse(body); prompt = j.prompt || ""; project = j.project || ""; sessionId = j.sessionId || ""; model = j.model || ""; caveman = !!j.caveman; } catch {}
      if (!prompt.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, output: "Empty prompt" }));
      }
      runClaude(prompt, project, sessionId, model, caveman, res);
    });
    return;
  }

  serveStatic(res, url === "/" ? "index.html" : url.slice(1));
});

// ---------- embedded terminal (real Claude REPL over WebSocket) ----------
// Each browser terminal tab gets its own ConPTY shell, dropped into `claude`
// in the chosen project. /model, /caveman, streaming — all work natively here.
if (pty && WebSocketServer) {
  const wss = new WebSocketServer({ server, path: "/terminal" });
  wss.on("connection", (ws, req) => {
    const u = new URL(req.url, "http://localhost");
    const project = u.searchParams.get("project") || "";
    let cwd = ROOT;
    if (project) {
      const c = path.join(ROOT, project);
      if (c.startsWith(ROOT) && fs.existsSync(c)) cwd = c;
    }
    const shell = process.env.ComSpec || "cmd.exe";
    const term = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 100,
      rows: 28,
      cwd,
      env: process.env,
    });
    term.onData((d) => { try { ws.send(d); } catch {} });
    term.onExit(() => { try { ws.close(); } catch {} });

    ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.i !== undefined) term.write(msg.i);                 // keystrokes
      else if (msg.r) { try { term.resize(msg.r[0], msg.r[1]); } catch {} } // resize
    });
    ws.on("close", () => { try { term.kill(); } catch {} });

    // drop the user straight into Claude in this context
    setTimeout(() => { try { term.write("claude\r"); } catch {} }, 500);
  });
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Brain Dashboard (master) -> http://127.0.0.1:${PORT}`);
  console.log(`  Watching: ${ROOT}`);
  console.log(`  Terminal pane: ${pty && WebSocketServer ? "ON" : "off (native module missing)"}\n`);
});
