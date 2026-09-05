#!/usr/bin/env node
/**
 * zchat-server — chat WEB local con la sesión de ZCode de una tarea.
 *
 *   node zchat-server.mjs <sessionId> <workspacePath> [planB64] [status] [agentState]
 *
 * Levanta un servidor en 127.0.0.1 (puerto 43110+) con:
 *  - Historial completo de la conversación (db.sqlite: message+part).
 *  - STREAMING en vivo: mientras el CLI responde, se poll-ea la DB (que es
 *    la misma que lee el desktop y se actualiza en caliente) y los bloques
 *    de texto nuevos viajan al navegador por SSE — se ve al agente escribir
 *    por partes, no 60s de silencio y la respuesta de golpe.
 *  - Sidebar con el PLAN de la tarea (viaja desde el tracker en el deep
 *    link, base64url) y el estado ACTUAL de la tarea: se inyecta en cada
 *    pregunta para que el agente no responda con datos viejos (ej. decía
 *    "para-revisión" de su turno cuando la tarea ya estaba completada).
 *  - Auto-apagado tras 30 min de inactividad (o botón "cerrar chat").
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";
import { existsSync, appendFileSync } from "node:fs";

const ZCODE_CLI =
  process.env.ZCODE_CLI ||
  path.join(
    os.homedir(),
    "AppData",
    "Local",
    "Programs",
    "ZCode",
    "resources",
    "glm",
    "zcode.cjs",
  );

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const LOG = path.join(HERE, "zchat-server.log");
const log = (m) => {
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
  } catch {}
};

const [sessionId, workspacePath, planB64, statusArg, stateArg] = process.argv.slice(2);
if (!sessionId || !workspacePath || !existsSync(ZCODE_CLI)) {
  console.error("uso: node zchat-server.mjs <sessionId> <workspacePath> [planB64] [status] [agentState]");
  process.exit(1);
}

const DB_PATH = path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite");

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

// Título de la sesión para el banner (read-only, no molesta al desktop).
let sessionTitle = "";
try {
  const db = openDb();
  sessionTitle = db.prepare("SELECT title FROM session WHERE id = ?").get(sessionId)?.title ?? "";
  db.close();
} catch {}

// Plan de la tarea (base64url de un JSON array de pasos) desde el tracker.
let plan = [];
try {
  if (planB64) {
    plan = JSON.parse(
      Buffer.from(planB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    );
    if (!Array.isArray(plan)) plan = [];
  }
} catch (e) {
  log(`plan no decodificable: ${e?.message ?? e}`);
  plan = [];
}
const taskStatus = (statusArg || "").slice(0, 40);
const taskAgentState = (stateArg || "").slice(0, 40);

/**
 * Conversación completa de la sesión (solo bloques de texto; saltean
 * reasoning/tools). Las sesiones NO se borran nunca: sirve para cualquier
 * tarea por vieja que sea.
 */
function readHistory(sessionId, limit = 80) {
  let db;
  try {
    db = openDb();
    const msgs = db
      .prepare("SELECT id, data FROM message WHERE session_id = ? ORDER BY sequence")
      .all(sessionId);
    const getParts = db.prepare(
      "SELECT data FROM part WHERE message_id = ? ORDER BY sequence",
    );
    const out = [];
    for (const m of msgs.slice(-limit)) {
      let role = "assistant";
      try {
        role = JSON.parse(m.data).role ?? role;
      } catch {}
      const texts = [];
      for (const p of getParts.all(m.id)) {
        try {
          const d = JSON.parse(p.data);
          if (d.type === "text" && d.text?.trim()) texts.push(d.text.trim());
        } catch {}
      }
      if (texts.length) out.push({ role, text: texts.join("\n\n") });
    }
    return out;
  } catch (e) {
    log(`history: ${e?.message ?? e}`);
    return [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/** rowid máximo de part para la sesión (marca de agua del streaming). */
function maxPartRowid() {
  try {
    const db = openDb();
    const r = db
      .prepare("SELECT COALESCE(MAX(rowid), 0) m FROM part WHERE session_id = ?")
      .get(sessionId);
    db.close();
    return r.m;
  } catch {
    return 0;
  }
}

/**
 * Bloques NUEVOS de la sesión desde un rowid: texto del assistant (deltas
 * del streaming) y tools (para el indicador de actividad). El desktop lee
 * esta misma tabla en vivo — es exactamente su fuente.
 */
function newPartsSince(rowid) {
  let db;
  try {
    db = openDb();
    const rows = db
      .prepare(
        `SELECT p.rowid rid, p.data pdata, m.data mdata
         FROM part p JOIN message m ON m.id = p.message_id
         WHERE p.session_id = ? AND p.rowid > ?
         ORDER BY p.rowid`,
      )
      .all(sessionId, rowid);
    const out = [];
    for (const r of rows) {
      let role = "assistant";
      let d;
      try {
        role = JSON.parse(r.mdata).role ?? role;
        d = JSON.parse(r.pdata);
      } catch {
        continue;
      }
      if (role !== "assistant") continue;
      if (d.type === "text" && d.text?.trim()) out.push({ kind: "text", text: d.text.trim(), rid: r.rid });
      else if (d.type === "tool") out.push({ kind: "tool", name: d.toolName ?? d.name ?? "", rid: r.rid });
    }
    return out;
  } catch (e) {
    log(`newParts: ${e?.message ?? e}`);
    return [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/* eslint-disable no-useless-escape */
const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chat con el agente — Hermes</title>
<style>
  :root{--bg:#010603;--panel:#0a100d;--panel2:#0e1613;--line:#1d2b26;--ink:#d7e4de;--mute:#8aa39a;--faint:#5c736b;--accent:#2dd4a7;--user:#123328}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "Segoe UI",system-ui,sans-serif;height:100vh;display:flex;flex-direction:column}
  header{padding:12px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
  header h1{margin:0;font-size:14px;color:var(--accent)}
  header p{margin:3px 0 0;font-size:11px;color:var(--faint)}
  #main{flex:1;display:flex;min-height:0}
  #chatwrap{flex:1;display:flex;flex-direction:column;min-width:0}
  #chat{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
  .msg{max-width:78%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  .msg.user{align-self:flex-end;background:var(--user);border:1px solid #1e4636}
  .msg.agent{align-self:flex-start;background:var(--panel2);border:1px solid var(--line)}
  .msg pre{background:#000;padding:10px;border-radius:8px;overflow-x:auto;font:12px/1.5 Consolas,monospace;white-space:pre}
  .msg code{font:12px Consolas,monospace;background:#000;padding:1px 5px;border-radius:4px}
  .live{color:var(--faint);font-style:italic;font-size:12px}
  .tool{align-self:flex-start;color:var(--faint);font-size:11px;font-style:italic;padding:0 14px}
  .dots span{animation:blink 1.2s infinite;border-radius:50%;display:inline-block;width:5px;height:5px;background:var(--accent);margin-right:3px}
  .dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}
  @keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
  footer{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line);background:var(--panel)}
  textarea{flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:10px 12px;font:14px/1.4 inherit;resize:none}
  button{background:var(--accent);border:0;color:#00291c;font-weight:600;border-radius:10px;padding:0 18px;cursor:pointer}
  button:disabled{opacity:.4;cursor:default}
  .cerrar{background:none;border:1px solid var(--line);color:var(--faint);font-size:11px;padding:6px 10px}
  aside{width:270px;flex-shrink:0;border-left:1px solid var(--line);background:var(--panel);overflow-y:auto;padding:14px}
  aside h2{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--mute)}
  aside ol{margin:0;padding-left:20px;font-size:12.5px;color:var(--ink)}
  aside li{margin-bottom:7px}
  .badge{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:11px;margin:0 4px 10px 0;background:var(--panel2)}
  .sep{margin:16px 0}
  @media(max-width:900px){aside{display:none}}
</style></head><body>
<header>
  <h1 id="t">Chat con el agente</h1>
  <p id="sub"></p>
</header>
<div id="main">
  <div id="chatwrap">
    <div id="chat"></div>
    <footer>
      <textarea id="q" rows="1" placeholder="Preguntale lo que quieras… (Enter envía, Shift+Enter salta línea)"></textarea>
      <button id="send">Enviar</button>
    </footer>
    <div style="padding:6px 18px 10px;background:var(--panel)"><button class="cerrar" id="quit">cerrar chat</button></div>
  </div>
  <aside id="side"></aside>
</div>
<script>
const chat=document.getElementById('chat'),q=document.getElementById('q'),send=document.getElementById('send');
let busy=false, es=null;
fetch('/info').then(r=>r.json()).then(i=>{
  document.getElementById('t').textContent='Chat con el agente'+(i.title?' — '+i.title:'');
  document.getElementById('sub').textContent=i.folder+' · respuesta en vivo, con todo el contexto de la sesión';
  if(i.plan&&i.plan.length){
    const side=document.getElementById('side');
    let h='<h2>Plan de la tarea</h2><ol>';
    for(const p of i.plan)h+='<li>'+esc(p)+'</li>';
    h+='</ol>';
    let ctx='<div class="sep"></div><h2>Estado en el tracker</h2>';
    if(i.status)ctx+='<span class="badge">'+esc(i.status)+'</span>';
    if(i.agentState)ctx+='<span class="badge">'+esc(i.agentState)+'</span>';
    side.innerHTML=h+ctx;
  }else if(i.status||i.agentState){
    document.getElementById('side').innerHTML='<h2>Estado en el tracker</h2>'+(i.status?'<span class="badge">'+esc(i.status)+'</span>':'')+(i.agentState?'<span class="badge">'+esc(i.agentState)+'</span>':'');
  }
});
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const md=s=>{
  let out='',parts=s.split(/\`\`\`/);
  for(let i=0;i<parts.length;i++){
    if(i%2){out+='<pre>'+esc(parts[i].replace(/^\\w*\\n/,''))+'</pre>';}
    else{
      let t=esc(parts[i]);
      t=t.replace(/\`([^\`]+)\`/g,'<code>$1</code>')
         .replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>')
         .replace(/^###? (.*)$/gm,'<b>$1</b>');
      out+=t;
    }
  }
  return out;
};
function bubble(cls,html){const d=document.createElement('div');d.className='msg '+cls;d.innerHTML=html;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d;}
// Historial previo de la conversación (lo ya hablado en ZCode desktop/CLI).
fetch('/history').then(r=>r.json()).then(j=>{
  const h=j.history||[];
  if(!h.length)return;
  const div=document.createElement('div');
  div.style.cssText='text-align:center;color:var(--faint);font-size:11px;padding:4px';
  div.textContent='── historial previo ('+h.length+' mensajes) ──';
  chat.appendChild(div);
  for(const m of h){
    const t=m.text.length>600?m.text.slice(0,600)+'…':m.text;
    const d=document.createElement('div');
    d.className='msg '+(m.role==='user'?'user':'agent');
    d.innerHTML=md(t);
    if(m.text.length>600)d.title=m.text;
    chat.appendChild(d);
  }
  chat.scrollTop=chat.scrollHeight;
});
function stopStream(){if(es){es.close();es=null;}}
async function ask(){
  const text=q.value.trim();
  if(!text||busy)return;
  busy=true;q.value='';q.disabled=true;send.disabled=true;
  bubble('user',esc(text));
  const live=document.createElement('div');
  live.className='tool';live.innerHTML='<span class="dots"><span></span><span></span><span></span></span> empezando…';
  chat.appendChild(live);chat.scrollTop=chat.scrollHeight;
  const b=bubble('agent live','');
  let acc='';
  stopStream();
  es=new EventSource('/stream');
  es.onmessage=(ev)=>{
    const j=JSON.parse(ev.data);
    if(j.delta!==undefined){acc+=(acc?'\\n\\n':'')+j.delta;b.textContent=acc;chat.scrollTop=chat.scrollHeight;}
    else if(j.tool){live.innerHTML='🔧 '+esc(j.tool);chat.scrollTop=chat.scrollHeight;}
  };
  es.addEventListener('done',(ev)=>{
    stopStream();
    let t=null;
    try{t=JSON.parse(ev.data).text;}catch{}
    b.classList.remove('live');
    b.innerHTML=md(t||acc||'(sin respuesta)');
    live.remove();
    finish();
  });
  try{
    const r=await fetch('/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text})});
    const j=await r.json();
    if(j.error){stopStream();b.classList.remove('live');b.innerHTML='<b style="color:#e55">error:</b> '+esc(j.error);live.remove();finish();}
  }catch(e){stopStream();b.classList.remove('live');b.innerHTML='<b style="color:#e55">error de conexión</b>';live.remove();finish();}
}
function finish(){busy=false;q.disabled=false;send.disabled=false;q.focus();chat.scrollTop=chat.scrollHeight;}
send.onclick=ask;
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask();}});
document.getElementById('quit').onclick=()=>{fetch('/quit',{method:'POST'}).finally(()=>window.close());};
q.focus();
</script></body></html>`;
/* eslint-enable no-useless-escape */

// ---- Servidor ----
let busy = false;
let lastActivity = Date.now();
/** Marca de agua del stream en curso + los SSE conectados. */
let askWatermark = 0;
const sseClients = new Set();

function sseBroadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {}
  }
}

function server(req, res) {
  lastActivity = Date.now();
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (req.method === "GET" && req.url === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        title: sessionTitle,
        folder: workspacePath,
        session: sessionId,
        plan,
        status: taskStatus,
        agentState: taskAgentState,
      }),
    );
    return;
  }
  if (req.method === "GET" && req.url === "/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ history: readHistory(sessionId) }));
    return;
  }
  if (req.method === "GET" && req.url === "/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(":ok\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (req.method === "POST" && req.url === "/ask") {
    if (busy) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ya hay una pregunta en curso" }));
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      busy = true;
      let question = "";
      try {
        question = String(JSON.parse(body).q || "").trim().slice(0, 4000);
      } catch {}
      if (!question) {
        busy = false;
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "pregunta vacía" }));
        return;
      }
      log(`pregunta: ${question.slice(0, 120)}`);

      // El agente responde desde SU memoria (a veces vieja): le inyecto el
      // estado ACTUAL de la tarea en el tracker para que no diga cosas como
      // "quedó en para-revisión" cuando ya la completaste hace horas.
      const contexto =
        (taskStatus || taskAgentState
          ? `[CONTEXTO ACTUALIZADO DEL TRACKER HERMES — priorizá esto sobre tus recuerdos: la tarea está en estado '${taskStatus || "?"}'${
              taskAgentState ? `, delegación '${taskAgentState}'` : ""
            } a esta hora.]\n`
          : "") + question;

      // Marca de agua ANTES de spawnear: todo part nuevo es stream.
      askWatermark = maxPartRowid();
      const child = spawn(
        process.execPath,
        [
          ZCODE_CLI,
          "-p",
          `Consulta de Cris sobre el trabajo ya entregado (solo respondé; no ejecutes cambios): ${contexto}`,
          "--resume",
          sessionId,
          "--cwd",
          workspacePath,
          "--mode",
          "plan",
          "--json",
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => log(`stderr: ${String(d).slice(0, 200)}`));

      // Stream en vivo: poll de la DB mientras corre el CLI.
      const poller = setInterval(() => {
        for (const p of newPartsSince(askWatermark)) {
          askWatermark = Math.max(askWatermark, p.rid);
          if (p.kind === "text") sseBroadcast({ delta: p.text });
          else if (p.kind === "tool" && p.name) sseBroadcast({ tool: p.name });
          else if (p.kind === "tool") sseBroadcast({ tool: "usando una herramienta…" });
        }
      }, 400);

      child.on("error", (e) => {
        clearInterval(poller);
        busy = false;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      });
      child.on("close", (code) => {
        clearInterval(poller);
        busy = false;
        let text = null;
        try {
          const j = JSON.parse(stdout);
          text = typeof j.response === "string" ? j.response : null;
        } catch {}
        log(`respuesta (exit ${code}): ${text ? text.length + " chars" : "sin texto"}`);
        for (const res2 of sseClients) {
          try {
            res2.write(`event: done\ndata: ${JSON.stringify({ text })}\n\n`);
          } catch {}
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, text }));
      });
    });
    return;
  }
  if (req.method === "POST" && req.url === "/quit") {
    res.writeHead(200);
    res.end("ok");
    setTimeout(() => process.exit(0), 300);
    return;
  }
  res.writeHead(404);
  res.end();
}

// Puerto libre en el rango, bind local únicamente.
let port = 43110;
const serverInst = http.createServer(server);
const listen = () =>
  new Promise((resolve, reject) => {
    serverInst.once("error", reject);
    serverInst.listen(port, "127.0.0.1", () => resolve());
  });
(async () => {
  for (let i = 0; i < 12; i++) {
    try {
      await listen();
      break;
    } catch {
      port++;
      if (i === 11) {
        log("sin puertos libres");
        process.exit(1);
      }
    }
  }
  const url = `http://127.0.0.1:${port}`;
  log(`arriba en ${url} · sesión ${sessionId} · ${workspacePath}`);
  spawn("cmd", ["/c", "start", "", url], { windowsHide: true });
  setInterval(() => {
    if (Date.now() - lastActivity > 30 * 60 * 1000) {
      log("idle timeout — chau");
      process.exit(0);
    }
  }, 60_000).unref();
})();
