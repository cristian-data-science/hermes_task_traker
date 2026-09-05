/*
 * zchat — cliente del chat con el agente (sin dependencias).
 *
 * Se carga BLOQUEANTE en el <head> a propósito: la primera sentencia aplica el
 * tema guardado antes del primer paint (sin flash). El resto arranca en
 * DOMContentLoaded.
 *
 * Fuentes de verdad:
 *   GET  /state    foto del servidor (turno en curso con sus bloques, tracker, seq)
 *   GET  /history  conversación completa de la sesión
 *   GET  /events   SSE: turn_start · part · delta · part_end · turn_done ·
 *                  turn_error · notice · tracker · resync
 *   POST /ask · /cancel · /quit
 *
 * Robustez: el SSE reconecta solo (Last-Event-ID → replay en el servidor);
 * tras cada reconexión y cada 8 s sin eventos con un turno abierto se pide
 * /state y se reconcilia. Todo evento es idempotente (los bloques se
 * identifican por id), así que repetir nunca duplica.
 */
(() => {
  "use strict";

  // ---------- tema (único: console/verde — decisión de Cris) ----------
  // Antes había tres temas (aurora/console/paper) con switcher; quedó fijo
  // el verde "console" y los otros dos se borraron del CSS y del HTML.
  const THEME_KEY = "zchat-theme";
  const params = new URLSearchParams(location.search);
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {}
  function applyTheme(t, persist) {
    if (t !== "console") t = "console";
    document.documentElement.dataset.theme = t;
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch {}
      savedTheme = t;
    }
  }
  applyTheme("console", false);

  // ---------- utilidades ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "html") n.innerHTML = v;
        else n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (children != null) {
      for (const c of Array.isArray(children) ? children : [children]) {
        if (c == null || c === false) continue;
        n.append(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return n;
  }
  const fmtTime = (ms) => {
    if (!ms) return "";
    const d = new Date(ms);
    const today = new Date();
    const hm = d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return hm;
    return `${d.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })} ${hm}`;
  };
  const fmtDur = (ms) => {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const fmtAgo = (ms) => {
    if (!ms) return "";
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 15) return "ahora";
    if (s < 90) return `hace ${s} s`;
    const m = Math.round(s / 60);
    if (m < 90) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 36) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  };
  const fmtK = (n) => {
    if (n == null) return "";
    if (n < 1000) return String(n);
    return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(".", ",")}k`;
  };
  const shortModel = (m) => (m ? String(m).split("/").pop() : "");

  async function getJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }
  async function postJson(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    let j = {};
    try {
      j = await r.json();
    } catch {}
    return { ok: r.ok, status: r.status, ...j };
  }

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
  }

  // ---------- markdown seguro ----------
  // Todo el texto se escapa ANTES de aplicar formato; solo se generan tags
  // conocidos y los href se validan como http(s).
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => {
      codes.push(c);
      return `${codes.length - 1}`;
    });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[\s(>])\*([^*\n]+?)\*(?=[\s).,;:!?<]|$)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[\s(>])_([^_\n]+?)_(?=[\s).,;:!?<]|$)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
    s = s.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`,
    );
    s = s.replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g,
      (_, pre, u) => `${pre}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
    );
    s = s.replace(/(\d+)/g, (_, i) => `<code>${codes[+i]}</code>`);
    return s;
  }
  function codeBlock(f) {
    return `<div class="code"><div class="code-head"><span>${esc(f.lang || "texto")}</span><button type="button" data-copy>copiar</button></div><pre><code>${esc(
      f.code.replace(/\n$/, ""),
    )}</code></pre></div>`;
  }
  function parseList(lines, i) {
    const items = [];
    while (i < lines.length) {
      const L = lines[i];
      const m = L.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (m) {
        items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), lines: [m[3]] });
        i++;
        continue;
      }
      if (items.length && /^\s+\S/.test(L)) {
        items[items.length - 1].lines.push(L.trim());
        i++;
        continue;
      }
      if (
        items.length &&
        /^\s*$/.test(L) &&
        i + 1 < lines.length &&
        /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1])
      ) {
        i++;
        continue;
      }
      break;
    }
    function build(start, indent) {
      const ordered = items[start].ordered;
      let html = ordered ? "<ol>" : "<ul>";
      let k = start;
      while (k < items.length && items[k].indent >= indent) {
        if (items[k].indent > indent) {
          const r = build(k, items[k].indent);
          html = html.replace(/<\/li>$/, r.html + "</li>");
          k = r.next;
          continue;
        }
        const it = items[k];
        let text = it.lines.join(" ");
        const task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          text = `<span class="task ${task[1].trim() ? "done" : ""}"></span>${inline(esc(task[2]))}`;
        } else text = inline(esc(text));
        html += `<li>${text}</li>`;
        k++;
      }
      html += ordered ? "</ol>" : "</ul>";
      return { html, next: k };
    }
    const r = build(0, items[0].indent);
    return { html: r.html, next: i };
  }
  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  function parseTable(lines, i) {
    const rows = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      rows.push(
        lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim()),
      );
      i++;
    }
    const head = rows[0] || [];
    const body = rows.slice(2);
    let html = `<div class="tbl"><table><thead><tr>${head.map((c) => `<th>${inline(esc(c))}</th>`).join("")}</tr></thead><tbody>`;
    for (const r of body) html += `<tr>${r.map((c) => `<td>${inline(esc(c))}</td>`).join("")}</tr>`;
    html += "</tbody></table></div>";
    return { html, next: i };
  }
  function md(src) {
    if (!src) return "";
    const fences = [];
    src = String(src).replace(/```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g, (_, lang, code) => {
      fences.push({ lang, code });
      return `${fences.length - 1}`;
    });
    // Fence sin cerrar (llega en streaming): el resto es código.
    src = src.replace(/```([\w+#.-]*)[^\n]*\n?([\s\S]*)$/, (_, lang, code) => {
      fences.push({ lang, code });
      return `${fences.length - 1}`;
    });
    const lines = src.split("\n");
    let out = "";
    let i = 0;
    const para = [];
    const flush = () => {
      if (para.length) {
        out += `<p>${inline(esc(para.join("\n"))).replace(/\n/g, "<br>")}</p>`;
        para.length = 0;
      }
    };
    while (i < lines.length) {
      const L = lines[i];
      let m;
      if (/^\s*$/.test(L)) {
        flush();
        i++;
        continue;
      }
      if ((m = L.match(/^\s*(\d+)\s*$/))) {
        flush();
        out += codeBlock(fences[+m[1]]);
        i++;
        continue;
      }
      if ((m = L.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush();
        const n = m[1].length;
        out += `<h${n}>${inline(esc(m[2]))}</h${n}>`;
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(L)) {
        flush();
        out += "<hr>";
        i++;
        continue;
      }
      if (/^\s*>/.test(L)) {
        flush();
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ""));
          i++;
        }
        out += `<blockquote>${md(buf.join("\n"))}</blockquote>`;
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        flush();
        const r = parseTable(lines, i);
        out += r.html;
        i = r.next;
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(L)) {
        flush();
        const r = parseList(lines, i);
        out += r.html;
        i = r.next;
        continue;
      }
      para.push(L);
      i++;
    }
    flush();
    // Un fence que quedó dentro de un párrafo (texto pegado) igual se expande.
    out = out.replace(/(\d+)/g, (_, k) => codeBlock(fences[+k]));
    return out;
  }

  // ---------- iconos ----------
  const ICON = {
    spark:
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/></svg>',
    chev: '<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    term: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-5-6-5"/><path d="M12 19h8"/></svg>',
    search:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    globe:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    plug: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0z"/><path d="M12 16v5"/></svg>',
    wand: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 4V2M15 10V8M11 6h2M17 6h2M4 20l10-10"/></svg>',
    list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    ask: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></svg>',
    gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    spinner:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>',
  };
  function toolIcon(tool, status) {
    if (status === "running") return ICON.spinner;
    if (!tool) return ICON.gear;
    if (tool.startsWith("mcp__")) return ICON.plug;
    switch (tool) {
      case "Read":
      case "Write":
      case "Edit":
      case "MultiEdit":
      case "NotebookEdit":
        return ICON.file;
      case "Bash":
        return ICON.term;
      case "Grep":
      case "Glob":
        return ICON.search;
      case "WebFetch":
      case "WebSearch":
        return ICON.globe;
      case "Skill":
        return ICON.wand;
      case "TodoWrite":
        return ICON.list;
      case "AskUserQuestion":
        return ICON.ask;
      default:
        return ICON.gear;
    }
  }
  function toolStatusLabel(p) {
    if (p.status === "running") return "ejecutando…";
    if (p.status === "pending") return "pendiente";
    if (p.status === "error") return "error";
    const d = p.end && p.start ? fmtDur(p.end - p.start) : "";
    return d ? `✓ ${d}` : "✓";
  }

  // ---------- estado ----------
  const S = {
    info: null,
    tracker: null,
    turns: new Map(),
    current: null,
    seq: 0,
    es: null,
    connected: false,
    wasDown: false,
    lastEventAt: 0,
    resyncing: false,
    ticker: null,
    sideOpen: true, // se decide en init() (ancho real de la ventana o preferencia guardada)
    welcome: null,
  };
  const SIDE_KEY = "zchat-side";
  let thread, scroll, statusEl, q, sendBtn, cancelBtn;

  // ---------- scroll ----------
  function nearBottom() {
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
  }
  function stick(force) {
    if (force || nearBottom()) {
      scroll.scrollTop = scroll.scrollHeight;
      $("jump").classList.add("hidden");
    } else {
      $("jump").classList.remove("hidden");
    }
  }

  // ---------- bloques ----------
  function makeThink() {
    const root = el("details", { class: "think live", open: true });
    const summary = el("summary");
    const label = el("span", { class: "t-label", text: "Razonando…" });
    const meta = el("span", { class: "t-meta" });
    summary.append(el("span", { class: "spark" }), label, meta, el("span", { html: ICON.chev }));
    const body = el("div", { class: "think-body" });
    root.append(summary, body);
    summary.addEventListener("click", () => {
      root.dataset.pinned = "1";
    });
    return { root, body, label, meta, start: Date.now(), chars: 0, ended: false };
  }
  function updateThink(v, text, start, end) {
    if (v.body.textContent !== text) {
      v.body.textContent = text;
      v.body.scrollTop = v.body.scrollHeight;
    }
    v.chars = text.length;
    if (start) v.start = start;
    if (end) endThink(v, end);
    else v.meta.textContent = `${fmtDur(Date.now() - v.start)} · ${fmtK(v.chars)} caracteres`;
  }
  function endThink(v, end) {
    if (v.ended) return;
    v.ended = true;
    v.root.classList.remove("live");
    v.label.textContent = "Razonó";
    v.meta.textContent = `${fmtDur((end || Date.now()) - v.start)} · ${fmtK(v.chars)} caracteres`;
    if (!v.root.dataset.pinned) v.root.open = false;
  }
  function makeTool(p) {
    const wrap = el("div", { class: "tool-wrap" });
    const row = el("div", { class: `tool ${p.status || "pending"}` });
    const ic = el("span", { class: "ic", html: toolIcon(p.tool, p.status) });
    const name = el("span", { class: "name", text: p.label || p.tool || "herramienta" });
    const sum = el("span", { class: "sum", text: p.summary || p.title || "" });
    const st = el("span", { class: "st", text: toolStatusLabel(p) });
    row.append(ic, name, sum, st);
    const out = el("pre", { class: "tool-out" });
    wrap.append(row, out);
    row.addEventListener("click", () => {
      if (wrap.classList.contains("has-out")) wrap.classList.toggle("open");
    });
    const v = { root: wrap, row, ic, name, sum, st, out };
    updateTool(v, p);
    return v;
  }
  function updateTool(v, p) {
    v.row.className = `tool ${p.status || "pending"}`;
    v.ic.innerHTML = toolIcon(p.tool, p.status);
    v.name.textContent = p.label || p.tool || "herramienta";
    v.sum.textContent = p.summary || p.title || "";
    v.sum.title = p.summary || p.title || "";
    v.st.textContent = toolStatusLabel(p);
    const outText = p.error || p.output || "";
    v.out.textContent = outText;
    v.root.classList.toggle("has-out", !!outText);
    v.row.title = outText ? "Ver salida" : "";
  }
  function makeAnswer(text, live) {
    const root = el("div", { class: `answer${text ? "" : " empty"}` });
    const body = el("div", { class: `md${live ? " live" : ""}`, html: md(text) });
    root.append(body);
    return { root, body, text: text || "" };
  }
  function updateAnswer(v, text, live) {
    if (v.text !== text) {
      v.text = text;
      v.body.innerHTML = md(text);
    }
    v.root.classList.toggle("empty", !text.trim());
    v.body.classList.toggle("live", !!live);
  }

  // ---------- render de historial ----------
  function renderUser(text, at) {
    const m = el("div", { class: "msg user" });
    m.append(el("div", { class: "who" }, [el("span", { text: "vos" }), el("span", { text: fmtTime(at) })]));
    m.append(el("div", { class: "bubble", text }));
    thread.append(m);
    return m;
  }
  function renderAgentShell() {
    const root = el("div", { class: "msg agent turn" });
    const avatar = el("div", { class: "avatar", html: ICON.spark });
    const body = el("div", { class: "turn-body" });
    root.append(avatar, body);
    thread.append(root);
    return { root, body };
  }
  /**
   * Los mensajes assistant consecutivos (uno por cada ida y vuelta con
   * herramientas dentro del mismo turno) se muestran como UN solo turno:
   * un avatar, los bloques en orden y la metadata sumada.
   */
  function groupHistory(msgs) {
    const out = [];
    for (const m of msgs) {
      const last = out[out.length - 1];
      if (m.role === "assistant" && last && last.role === "assistant") {
        last.blocks.push(...m.blocks);
        last.completedAt = m.completedAt || last.completedAt;
        last.model = m.model || last.model;
        if (m.tokens) {
          const t = last.tokens || { input: 0, output: 0, total: 0, cacheRead: 0 };
          t.input += m.tokens.input || 0;
          t.output += m.tokens.output || 0;
          t.total += m.tokens.total || 0;
          t.cacheRead += m.tokens.cacheRead || 0;
          last.tokens = t;
        }
        last.count = (last.count || 1) + 1;
        continue;
      }
      out.push({ ...m, blocks: [...m.blocks], count: 1 });
    }
    return out;
  }
  function renderHistoryMessage(m) {
    if (m.role === "user") {
      renderUser(m.blocks.map((b) => b.text).join("\n\n"), m.at);
      return;
    }
    const { root, body } = renderAgentShell();
    let tools = null;
    for (const b of m.blocks) {
      if (b.kind === "reasoning") {
        tools = null;
        const v = makeThink();
        v.start = b.start || b.at;
        updateThink(v, b.text, v.start, b.end || b.updatedAt || v.start + 1);
        body.append(v.root);
      } else if (b.kind === "tool") {
        if (!tools) {
          tools = el("div", { class: "tools" });
          body.append(tools);
        }
        tools.append(makeTool(b).root);
      } else if (b.kind === "text") {
        tools = null;
        body.append(makeAnswer(b.text, false).root);
      }
    }
    const bits = [];
    if (m.model) bits.push(`<b>${esc(shortModel(m.model))}</b>`);
    if (m.completedAt && m.at && m.completedAt > m.at) bits.push(esc(fmtDur(m.completedAt - m.at)));
    const nTools = m.blocks.filter((b) => b.kind === "tool").length;
    if (nTools) bits.push(`${nTools} ${nTools === 1 ? "herramienta" : "herramientas"}`);
    if (m.tokens?.output) bits.push(`${esc(fmtK(m.tokens.output))} tokens de salida`);
    bits.push(esc(fmtTime(m.at)));
    body.append(el("div", { class: "meta", html: bits.join(" · ") }));
    root.classList.add("history");
  }
  async function loadHistory() {
    let h;
    try {
      h = await getJson("/history");
    } catch (e) {
      thread.append(el("div", { class: "notice warn", text: `No pude leer el historial de la sesión: ${e.message}` }));
      return;
    }
    const msgs = h.messages || [];
    if (!msgs.length) {
      showWelcome();
      return;
    }
    thread.append(
      el("div", {
        class: "divider",
        text:
          h.total > msgs.length
            ? `historial de la sesión · últimos ${msgs.length} de ${h.total} mensajes`
            : `historial de la sesión · ${msgs.length} mensajes`,
      }),
    );
    for (const m of groupHistory(msgs)) renderHistoryMessage(m);
    stick(true);
  }
  function showWelcome() {
    if (S.welcome) return;
    const w = el("div", { class: "welcome" });
    w.append(
      el("h3", { text: "Esta sesión todavía no tiene conversación" }),
      el("p", { text: "El agente tiene todo el contexto de lo que hizo en la tarea. Preguntale lo que quieras." }),
    );
    const sugg = el("div", { class: "sugg" });
    for (const s of ["¿Qué cambiaste exactamente y dónde?", "¿Cómo verificaste el resultado?", "Resumime en 3 líneas qué quedó hecho", "¿Qué quedó pendiente o con riesgo?"]) {
      const b = el("button", { type: "button", text: s });
      b.addEventListener("click", () => {
        q.value = s;
        autosize();
        q.focus();
      });
      sugg.append(b);
    }
    w.append(sugg);
    thread.append(w);
    S.welcome = w;
  }

  // ---------- turno en vivo ----------
  class TurnView {
    constructor(t) {
      this.id = t.id;
      this.question = t.question;
      this.startedAt = t.startedAt || Date.now();
      this.status = "running";
      this.parts = new Map();
      this.lastTools = null;
      this.userEl = renderUser(t.question, this.startedAt);
      const shell = renderAgentShell();
      this.root = shell.root;
      this.body = shell.body;
      this.root.classList.add("live");
      this.pending = el("div", { class: "pending" });
      this.pending.append(
        el("span", { class: "dots" }, [el("span"), el("span"), el("span")]),
        el("span", { class: "pending-text", text: "Conectando con la sesión del agente…" }),
      );
      this.body.append(this.pending);
      this.metaEl = null;
    }
    lastPart() {
      let last = null;
      for (const p of this.parts.values()) if (!last || p.data.order >= last.data.order) last = p;
      return last;
    }
    applyPart(part) {
      if (this.status !== "running" && !this.parts.has(part.id)) return;
      this.pending?.remove();
      this.pending = null;
      let p = this.parts.get(part.id);
      if (!p) {
        p = { data: part, view: null };
        this.parts.set(part.id, p);
        if (part.kind === "reasoning") {
          // Un razonamiento nuevo cierra los anteriores que sigan abiertos.
          for (const other of this.parts.values()) if (other !== p && other.data.kind === "reasoning" && other.view) endThink(other.view, other.data.end);
          p.view = makeThink();
          p.view.start = part.start || part.at || Date.now();
          this.lastTools = null;
          this.body.append(p.view.root);
        } else if (part.kind === "tool") {
          for (const other of this.parts.values()) if (other !== p && other.data.kind === "reasoning" && other.view) endThink(other.view, other.data.end);
          if (!this.lastTools) {
            this.lastTools = el("div", { class: "tools" });
            this.body.append(this.lastTools);
          }
          p.view = makeTool(part);
          this.lastTools.append(p.view.root);
        } else if (part.kind === "text") {
          for (const other of this.parts.values()) if (other !== p && other.data.kind === "reasoning" && other.view) endThink(other.view, other.data.end);
          this.lastTools = null;
          p.view = makeAnswer(part.text, !part.end);
          this.body.append(p.view.root);
        }
      } else {
        p.data = { ...p.data, ...part };
      }
      this.refresh(p);
      stick();
    }
    applyDelta(id, delta, end) {
      const p = this.parts.get(id);
      if (!p) {
        resync();
        return;
      }
      p.data.text = (p.data.text || "") + delta;
      if (end) p.data.end = end;
      this.refresh(p);
      stick();
    }
    endPart(id, end) {
      const p = this.parts.get(id);
      if (!p) return;
      p.data.end = end || Date.now();
      this.refresh(p);
    }
    refresh(p) {
      const d = p.data;
      if (!p.view) return;
      if (d.kind === "reasoning") updateThink(p.view, d.text || "", d.start, d.end);
      else if (d.kind === "tool") updateTool(p.view, d);
      else if (d.kind === "text") updateAnswer(p.view, d.text || "", this.status === "running" && !d.end);
    }
    joinedText() {
      return [...this.parts.values()]
        .filter((p) => p.data.kind === "text" && (p.data.text || "").trim())
        .sort((a, b) => a.data.order - b.data.order)
        .map((p) => p.data.text.trim())
        .join("\n\n");
    }
    notice(n) {
      this.body.append(el("div", { class: `notice ${n.level || "info"}`, text: n.text }));
      stick();
    }
    setPhase(text) {
      this.phase = text || "";
      if (this.pending) {
        const span = this.pending.querySelector(".pending-text");
        if (span && text) span.textContent = text;
      }
    }
    finish(d) {
      if (this.status !== "running") return;
      this.status = d.cancelled ? "cancelled" : "done";
      this.pending?.remove();
      this.pending = null;
      this.root.classList.remove("live");
      for (const p of this.parts.values()) {
        if (p.data.kind === "reasoning" && p.view) endThink(p.view, p.data.end);
        if (p.data.kind === "text" && p.view) updateAnswer(p.view, p.data.text || "", false);
      }
      const joined = this.joinedText();
      const finalText = (d.text || "").trim();
      if (finalText && (!joined || finalText.length > joined.length + 2)) {
        // La DB no alcanzó a mostrar todo (o llegó solo por stdout): texto autoritativo.
        for (const p of this.parts.values()) if (p.data.kind === "text" && p.view) p.view.root.remove();
        this.body.append(makeAnswer(finalText, false).root);
      }
      if (!finalText && !joined && !d.cancelled) {
        this.body.append(el("div", { class: "notice warn", text: "El agente terminó sin texto de respuesta." }));
      }
      if (d.cancelled) this.body.append(el("div", { class: "notice info", text: "Respuesta detenida por vos." }));
      const bits = [];
      if (d.model) bits.push(`<b>${esc(shortModel(d.model))}</b>`);
      const dur = d.durationMs ?? (d.endedAt ? d.endedAt - this.startedAt : null);
      if (dur != null) bits.push(esc(fmtDur(dur)));
      if (d.tokens?.output) bits.push(`${esc(fmtK(d.tokens.output))} tokens de salida`);
      if (d.tokens?.cacheRead) bits.push(`${esc(fmtK(d.tokens.cacheRead))} en caché`);
      bits.push(esc(fmtTime(d.endedAt || Date.now())));
      this.metaEl = el("div", { class: "meta", html: bits.join(" · ") });
      this.body.append(this.metaEl);
      if (S.current === this) setBusy(false);
      setStatus(null);
      stick();
    }
    fail(error, partialText) {
      if (this.status !== "running") return;
      this.status = "error";
      this.pending?.remove();
      this.pending = null;
      this.root.classList.remove("live");
      for (const p of this.parts.values()) {
        if (p.data.kind === "reasoning" && p.view) endThink(p.view, p.data.end);
        if (p.data.kind === "text" && p.view) updateAnswer(p.view, p.data.text || "", false);
      }
      if (partialText && !this.joinedText()) this.body.append(makeAnswer(partialText, false).root);
      this.body.append(el("div", { class: "notice", text: error || "La respuesta falló." }));
      if (S.current === this) setBusy(false);
      setStatus(null);
      stick();
    }
  }

  function ensureTurn(snap) {
    let v = S.turns.get(snap.id);
    if (v) return v;
    if (S.welcome) {
      S.welcome.remove();
      S.welcome = null;
    }
    v = new TurnView(snap);
    S.turns.set(snap.id, v);
    S.current = v;
    setBusy(true);
    if (snap.phase) v.setPhase(snap.phase);
    for (const p of snap.parts || []) v.applyPart(p);
    stick(true);
    return v;
  }
  function hydrateTurn(snap) {
    const v = ensureTurn(snap);
    for (const p of snap.parts || []) v.applyPart(p);
    if (snap.status === "done" || snap.status === "cancelled") {
      v.finish({
        text: snap.finalText,
        tokens: snap.tokens,
        model: snap.model,
        durationMs: (snap.endedAt || Date.now()) - snap.startedAt,
        endedAt: snap.endedAt,
        cancelled: snap.cancelled,
      });
    } else if (snap.status === "error") {
      v.fail(snap.error);
    }
  }

  // ---------- SSE ----------
  function setConn(on) {
    S.connected = on;
    const c = $("conn");
    c.classList.toggle("live", on);
    c.classList.toggle("off", !on);
    c.querySelector("span").textContent = on ? "en vivo" : "reconectando…";
  }
  function connectSSE(since) {
    if (S.es) S.es.close();
    const es = new EventSource(`/events?since=${encodeURIComponent(since ?? 0)}`);
    S.es = es;
    es.onopen = () => {
      setConn(true);
      if (S.wasDown) {
        S.wasDown = false;
        resync();
      }
    };
    es.onerror = () => {
      setConn(false);
      S.wasDown = true;
    };
    const on = (type, fn) =>
      es.addEventListener(type, (e) => {
        let d;
        try {
          d = JSON.parse(e.data);
        } catch {
          return;
        }
        if (d.seq) S.seq = Math.max(S.seq, d.seq);
        S.lastEventAt = Date.now();
        try {
          fn(d);
        } catch (err) {
          console.error(type, err);
        }
      });
    const view = (id) => {
      const v = S.turns.get(id);
      if (!v) resync();
      return v;
    };
    on("turn_start", (d) => ensureTurn({ id: d.turnId, question: d.question, startedAt: d.startedAt, parts: [] }));
    on("part", (d) => view(d.turnId)?.applyPart(d.part));
    on("delta", (d) => view(d.turnId)?.applyDelta(d.id, d.delta, d.end));
    on("part_end", (d) => view(d.turnId)?.endPart(d.id, d.end));
    on("turn_done", (d) => view(d.turnId)?.finish(d));
    on("turn_error", (d) => view(d.turnId)?.fail(d.error, d.partialText));
    on("notice", (d) => view(d.turnId)?.notice(d));
    on("phase", (d) => view(d.turnId)?.setPhase(d.text));
    on("tracker", (d) => renderTracker(d.tracker));
    es.addEventListener("resync", () => resync());
  }
  async function resync() {
    if (S.resyncing) return;
    S.resyncing = true;
    try {
      const st = await getJson("/state");
      S.seq = Math.max(S.seq, st.seq || 0);
      S.lastEventAt = Date.now();
      if (st.tracker) renderTracker(st.tracker);
      if (st.turn) {
        if (S.turns.has(st.turn.id) || st.turn.status === "running") hydrateTurn(st.turn);
      }
      if (S.current && S.current.status === "running" && (!st.turn || st.turn.id !== S.current.id)) {
        S.current.fail("El servidor del chat perdió este turno (se reinició). Volvé a preguntar.");
      }
      if (st.info && (!S.info || st.info.pid !== S.info.pid)) {
        // Servidor nuevo: los seq arrancan de cero → reconectar el SSE.
        S.info = st.info;
        connectSSE(st.seq || 0);
      }
    } catch (e) {
      setConn(false);
    } finally {
      S.resyncing = false;
    }
  }

  // ---------- estado / composer ----------
  function setBusy(b) {
    q.disabled = b;
    sendBtn.disabled = b || !q.value.trim();
    cancelBtn.classList.toggle("hidden", !b);
    if (!b) q.focus();
  }
  function setStatus(html) {
    if (!html) {
      statusEl.innerHTML = "";
      return;
    }
    statusEl.innerHTML = html;
  }
  function tick() {
    const v = S.current;
    if (v && v.status === "running") {
      const last = v.lastPart();
      const elapsed = fmtDur(Date.now() - v.startedAt);
      let phase = "Conectando";
      let detail = v.phase || "con la sesión del agente…";
      if (last) {
        const d = last.data;
        if (d.kind === "reasoning" && !d.end) {
          phase = "Pensando";
          detail = `${fmtK(d.text.length)} caracteres de razonamiento`;
        } else if (d.kind === "tool" && (d.status === "running" || d.status === "pending")) {
          phase = d.label || d.tool;
          detail = d.summary || d.title || (d.status === "pending" ? "preparando…" : "");
        } else if (d.kind === "text" && !d.end) {
          phase = "Escribiendo";
          detail = "";
        } else {
          phase = "Procesando";
          detail = v.phase && !/^(Razonando|Escribiendo)/.test(v.phase) ? v.phase : "el siguiente paso…";
        }
      }
      setStatus(
        `<span class="dot"></span><span class="phase">${esc(phase)}</span><span class="detail">${esc(detail)}</span><span class="elapsed">${esc(elapsed)}</span>`,
      );
      if (S.lastEventAt && Date.now() - S.lastEventAt > 8000) {
        S.lastEventAt = Date.now();
        resync();
      }
    }
    // Tiempos relativos del panel (cada ~30 s alcanza).
    if (S.tracker && Date.now() % 30000 < 1000) renderTracker(S.tracker);
  }
  function autosize() {
    q.style.height = "auto";
    q.style.height = Math.min(q.scrollHeight, 220) + "px";
    sendBtn.disabled = q.disabled || !q.value.trim();
  }
  async function send() {
    const text = q.value.trim();
    if (!text || (S.current && S.current.status === "running")) return;
    q.value = "";
    autosize();
    setBusy(true);
    setStatus(`<span class="dot"></span><span class="phase">Enviando</span><span class="detail">…</span>`);
    let r;
    try {
      r = await postJson("/ask", { q: text });
    } catch {
      toast("Sin conexión con el servidor local del chat.");
      q.value = text;
      autosize();
      setBusy(false);
      setStatus(null);
      return;
    }
    if (!r.ok) {
      toast(r.error || `No se pudo enviar (HTTP ${r.status}).`);
      if (r.status !== 409) {
        q.value = text;
        autosize();
      }
      setBusy(r.status === 409);
      if (r.status !== 409) setStatus(null);
      return;
    }
    ensureTurn({ id: r.turnId, question: r.question || text, startedAt: r.startedAt || Date.now(), parts: [] });
  }
  async function cancel() {
    cancelBtn.disabled = true;
    try {
      await postJson("/cancel", {});
    } finally {
      cancelBtn.disabled = false;
    }
  }

  // ---------- panel de misión ----------
  const STATE_META = {
    encolada: ["En cola", "muted", false],
    despachada: ["Despachada", "accent", true],
    trabajando: ["Trabajando", "accent", true],
    pregunta: ["Pregunta", "warn", true],
    "para-revision": ["Para revisión", "info", false],
    hecho: ["Hecho", "ok", false],
    error: ["Error", "err", true],
    cancelada: ["Cancelada", "muted", false],
  };
  const STATUS_LABEL = {
    urgente: "Urgente",
    pendiente: "Pendiente",
    "en-curso": "En curso",
    standby: "Standby",
    programado: "Programado",
    completado: "Completado",
  };
  const TYPE_LABEL = { reporte: "Reporte", desarrollo: "Desarrollo", analisis: "Análisis", ops: "Ops", otro: "Otro" };
  const AUTONOMY_LABEL = { escenario: "Escenario", supervisado: "Supervisado", autonomo: "Autónomo" };
  function chip(label, tone, pulse) {
    return `<span class="chip tone-${tone || "muted"}${pulse ? " pulse" : ""}"><i></i>${esc(label)}</span>`;
  }
  function renderTracker(tr) {
    S.tracker = tr;
    const task = tr?.task || {};
    const run = tr?.run || null;
    const info = S.info || {};
    const title = task.title || info.title || "";
    if (title) {
      $("title").textContent = title;
      document.title = `${title} — chat con el agente`;
    }
    const sm = STATE_META[task.agentState] || null;
    const parts = [];
    parts.push(
      `<div class="side-head"><h2>Misión</h2><span class="live-pill ${tr?.live ? "" : "off"}"><i></i>${
        tr?.live ? "tracker en vivo" : task.deleted ? "tarea no encontrada" : "snapshot del enlace"
      }</span></div>`,
    );
    // Tarjeta de la tarea
    const chips = [];
    if (sm) chips.push(chip(sm[0], sm[1], sm[2]));
    if (task.status) chips.push(chip(STATUS_LABEL[task.status] || task.status, "muted"));
    if (task.taskType || task.autonomy) chips.push(chip([TYPE_LABEL[task.taskType] || task.taskType, AUTONOMY_LABEL[task.autonomy] || task.autonomy].filter(Boolean).join(" · "), "muted"));
    const modelName = shortModel(run?.model || task.model);
    if (modelName) chips.push(chip(modelName, "accent"));
    parts.push(
      `<div class="card"><div class="task-title">${esc(title || "Tarea sin título")}</div>${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}${
        task.question && task.agentState === "pregunta"
          ? `<p class="summary-text mt10"><strong>Pregunta abierta:</strong> ${esc(task.question)}</p>`
          : ""
      }</div>`,
    );
    // Plan
    const plan = run?.plan || [];
    const steps = run?.steps || [];
    if (plan.length) {
      const done = run.doneCount ?? steps.length;
      const current = run.current ?? 0;
      const pct = Math.round((Math.min(done, plan.length) / plan.length) * 100);
      const items = plan
        .map((p, i) => {
          const isDone = i < done;
          const isCur = run.planOpen && i === done;
          let activity = "";
          if (isCur && run.lastActivity && run.open) {
            activity = `<span class="activity${run.stalled ? " stalled" : ""}" title="${esc(run.lastActivity)}">${run.stalled ? "⚠ " : "▸ "}${esc(run.lastActivity)}</span>`;
          }
          return `<li class="step ${isDone ? "done" : isCur ? "current" : ""}"><span class="mark">${isDone ? "✓" : isCur ? "▶" : i + 1}</span><span class="text">${esc(p)}${activity}</span></li>`;
        })
        .join("");
      parts.push(
        `<div class="sec"><div class="sec-head"><h2>Plan del agente</h2><span class="count">${
          run.planOpen ? `paso ${current} de ${plan.length}` : `${Math.min(done, plan.length)} / ${plan.length} reportados`
        }</span></div><div class="progress"><div class="bar"><i data-w="${pct}"></i></div><span class="pct">${pct}%</span></div><ol class="steps">${items}</ol></div>`,
      );
    }
    // Pasos reportados
    if (steps.length) {
      const items = steps
        .map(
          (s, i) =>
            `<li class="${i === steps.length - 1 ? "last" : ""}"><span class="n">${i + 1}.</span><span>${esc(s.text)}</span><time title="${esc(fmtTime(s.at))}">${esc(fmtAgo(s.at))}</time></li>`,
        )
        .join("");
      parts.push(`<div class="sec"><div class="sec-head"><h2>Pasos reportados</h2><span class="count">${steps.length}</span></div><ul class="log">${items}</ul></div>`);
    }
    // Actividad en vivo (corrida abierta sin plan visible, o actividad no mostrada arriba)
    if (run?.open && run.lastActivity && !(plan.length && run.planOpen)) {
      parts.push(
        `<div class="sec"><h2>Actividad</h2><div class="live-line${run.stalled ? " stalled" : ""}"><i></i><span title="${esc(run.lastActivity)}">${esc(run.lastActivity)}</span></div><div class="side-foot left">${esc(fmtAgo(run.lastActivityAt))}${run.stalled ? " · posible atasco" : ""}</div></div>`,
      );
    }
    // Resumen / error de la última corrida
    if (run?.summary || run?.error) {
      parts.push(
        `<div class="sec"><h2>${run.error ? "Último error" : "Resumen del agente"}</h2><p class="summary-text">${esc(run.error || run.summary)}</p>${
          run.endedAt ? `<div class="side-foot left">${esc(fmtTime(run.endedAt))}${run.runsCount > 1 ? ` · ${run.runsCount} corridas` : ""}</div>` : ""
        }</div>`,
      );
    }
    // Sesión
    const folder = info.folder || "";
    parts.push(
      `<div class="sec"><h2>Sesión</h2><div class="kv"><span class="k">Carpeta</span><span class="v"><span>${esc(folder)}</span>${
        folder ? `<a href="hermesagent://open?path=${encodeURIComponent(folder)}" title="Abrir en el Explorador">abrir</a>` : ""
      }</span></div><div class="kv"><span class="k">Sesión ZCode</span><span class="v"><span>${esc(info.session || "")}</span><button type="button" data-copy-text="${esc(
        info.session || "",
      )}" title="Copiar el id para /resume en el desktop">copiar</button></span></div>${
        modelName ? `<div class="kv"><span class="k">Modelo</span><span class="v">${esc(modelName)}</span></div>` : ""
      }</div>`,
    );
    parts.push(`<div class="side-foot">${tr?.live ? `actualizado ${esc(fmtAgo(tr.updatedAt))}` : "sin conexión al tracker: el plan es el del momento en que abriste el chat"}${info.demo ? " · modo demo" : ""}</div>`);
    const inner = $("sideInner");
    inner.innerHTML = parts.join("");
    inner.querySelectorAll(".bar i[data-w]").forEach((b) => {
      b.style.width = `${b.dataset.w}%`;
    });
    const sub = [folder ? folder.split(/[\\/]/).filter(Boolean).pop() : "", info.demo ? "modo demo" : "respuesta en vivo con todo el contexto de la sesión"]
      .filter(Boolean)
      .join(" · ");
    $("subtitle").textContent = sub;
    $("subtitle").title = folder;
  }

  // ---------- arranque ----------
  function setSide(open, persist) {
    S.sideOpen = open;
    $("app").classList.toggle("side-closed", !open);
    $("toggleSide").classList.toggle("on", open);
    if (persist) {
      try {
        localStorage.setItem(SIDE_KEY, open ? "1" : "0");
      } catch {}
    }
  }
  async function init() {
    thread = $("thread");
    scroll = $("scroll");
    statusEl = $("status");
    q = $("q");
    sendBtn = $("send");
    cancelBtn = $("cancel");
    applyTheme(document.documentElement.dataset.theme, false);
    let savedSide = null;
    try {
      savedSide = localStorage.getItem(SIDE_KEY);
    } catch {}
    setSide(savedSide === "1" ? true : savedSide === "0" ? false : window.innerWidth > 1000, false);

    $("toggleSide").addEventListener("click", () => setSide(!S.sideOpen, true));
    // Sin preferencia guardada, el panel sigue al ancho de la ventana.
    window.addEventListener("resize", () => {
      let pref = null;
      try {
        pref = localStorage.getItem(SIDE_KEY);
      } catch {}
      if (pref === null) setSide(window.innerWidth > 1000, false);
    });
    $("jump").addEventListener("click", () => stick(true));
    scroll.addEventListener("scroll", () => {
      if (nearBottom()) $("jump").classList.add("hidden");
    });
    sendBtn.addEventListener("click", send);
    cancelBtn.addEventListener("click", cancel);
    q.addEventListener("input", autosize);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    document.addEventListener("click", async (e) => {
      const copyCode = e.target.closest("[data-copy]");
      if (copyCode) {
        const code = copyCode.closest(".code")?.querySelector("code")?.textContent ?? "";
        try {
          await navigator.clipboard.writeText(code);
          copyCode.textContent = "copiado ✓";
          setTimeout(() => (copyCode.textContent = "copiar"), 1400);
        } catch {
          toast("No pude copiar al portapapeles.");
        }
      }
      const copyText = e.target.closest("[data-copy-text]");
      if (copyText) {
        try {
          await navigator.clipboard.writeText(copyText.dataset.copyText);
          toast("Copiado.");
        } catch {
          toast("No pude copiar al portapapeles.");
        }
      }
    });
    $("quit").addEventListener("click", async () => {
      if (S.current && S.current.status === "running" && !confirm("Hay una respuesta en curso. ¿Cerrar igual?")) return;
      try {
        await postJson("/quit", {});
      } catch {}
      S.es?.close();
      const ov = el("div", { class: "overlay" });
      ov.append(
        el("div", { class: "card" }, [
          el("h3", { text: "Chat cerrado" }),
          el("p", { text: "El servidor local se apagó. Ya podés cerrar esta pestaña; la conversación queda guardada en la sesión de ZCode." }),
        ]),
      );
      document.body.append(ov);
      setTimeout(() => window.close(), 400);
    });

    let st;
    try {
      st = await getJson("/state");
    } catch (e) {
      thread.append(el("div", { class: "notice", text: `No pude hablar con el servidor local del chat: ${e.message}` }));
      setConn(false);
      return;
    }
    S.info = st.info;
    S.seq = st.seq || 0;
    renderTracker(st.tracker);
    await loadHistory();
    if (st.turn && st.turn.status === "running") hydrateTurn(st.turn);
    connectSSE(S.seq);
    S.lastEventAt = Date.now();
    S.ticker = setInterval(tick, 1000);
    autosize();
    q.focus();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
