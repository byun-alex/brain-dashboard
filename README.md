# Brain Dashboard ("Jarvis")

A local web app that turns a bare terminal into a visual home base for working with Claude across every project on my machine, like an Iron-Man-style "Jarvis" launch screen. Chat with Claude or drop into a real embedded Claude terminal, switch which project Claude is working in, and watch token cost in real time.

Built to make an AI assistant feel like a control center, not a command line.

## What it does

- **Jarvis chat** — talk to Claude in a clean UI; it can read/edit any file in any project by path.
- **Project context switching** — pick a project and Claude runs *in that folder* (loads that project's own rules/`CLAUDE.md`).
- **Embedded real terminal** — a true Claude REPL inside the page (xterm.js + WebSocket → ConPTY), so native commands like `/model` and streaming work for real.
- **Model switching** — Opus / Sonnet / Haiku on the fly.
- **Live cost awareness** — per-message and running-session token + cost stats, so every AI call's bill is visible.
- **Slash-command autofill**, churning/elapsed status, conversation memory across turns.

## Architecture

| Piece | How |
|---|---|
| **Server** | Node.js `server.js` — plain `http` (no framework) serving `public/`, plus a `ws` WebSocket server for the terminal. |
| **Chat** | Spawns Claude headless (`claude -p --output-format json`), parses usage to compute cost. |
| **Embedded terminal** | `@homebridge/node-pty-prebuilt-multiarch` bridges a real ConPTY process to the browser over WebSocket; **xterm.js** renders it. |
| **Frontend** | Vanilla HTML/CSS/JS in `public/` — no framework, deliberately lightweight. |
| **Persona** | A `CLAUDE.md` defines the "Jarvis" voice + how it reasons across all projects. |

## Notable engineering detail

The embedded terminal was the hard part. Plain `node-pty` and `node-pty-prebuilt-multiarch` both fail on Node 24 on Windows (`spawn EINVAL`); the **Homebridge prebuilt fork** is the one that works. Picking the right PTY binding + wiring ConPTY ↔ WebSocket ↔ xterm.js is what makes a genuine REPL run in the browser instead of a fake shell.

## Run it

```bash
npm install
node server.js          # serves http://localhost:4317
# or double-click "Start Brain.bat" on Windows
```
Requires the Claude CLI installed and on PATH. The terminal pane loads xterm.js from a CDN (needs internet).

## Stack

Node.js · `ws` (WebSockets) · `@homebridge/node-pty-prebuilt-multiarch` (ConPTY) · xterm.js · vanilla JS/HTML/CSS · Claude CLI.

---
*Personal project demonstrating Node back-end work, real-time WebSocket/PTY integration, and practical orchestration of an AI CLI into a usable app. Built by Alex.*
