#!/usr/bin/env node
/**
 * zchat-server — chat WEB local con la sesión de ZCode de una tarea.
 *
 *   node zchat-server.mjs <sessionId> <workspacePath>
 *
 * Levanta un servidor en 127.0.0.1 (puerto 43110+) que sirve una página de
 * chat con la estética de Hermes y contesta con `zcode -p --resume`:
 * la sesión EXACTA de la tarea, contexto completo, turno a turno. Se abre
 * solo en el navegador y se auto-apaga tras 30 min de inactividad.
 *
 * Por qué no el TUI del CLI (@zcode/tui no existe fuera del app.asar) ni el
 * desktop (sin deep-link de sesiones; las automatizaciones a ciegas fallan):
 * ver comentarios en protocol-handler.vbs y zchat.mjs.
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

const [sessionId, workspacePath] = process.argv.slice(2);
if (!sessionId || !workspacePath || !existsSync(ZCODE_CLI)) {
  console.error("uso: node zchat-server.mjs <sessionId> <workspacePath>");
  process.exit(1);
}

// Título de la sesión para el banner (read-only, no molesta al desktop).
let sessionTitle = "";
try {
  const db = new DatabaseSync(
    path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite"),
    { readOnly: true },
  );
  sessionTitle = db.prepare("SELECT title FROM session WHERE id = ?").get(sessionId)?.title ?? "";
  db.close();
} catch {}

/**
 * Conversación completa de la sesión, leída de db.sqlite (message+part).
 * Las sesiones NO se borran nunca, así que esto sirve para cualquier tarea
 * por vieja que sea: es el revisor de conversaciones sin depender del
 * desktop (cuyo índice de búsqueda solo se arma al arrancar la app y no ve
 * las sesiones creadas después).
 * Devuelve los ÚLTIMOS `limit` mensajes con texto (saltean reasoning/tools).
 */
function readHistory(sessionId, limit = 80) {
  let db;
  try {
    db = new DatabaseSync(
      path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite"),
      { readOnly: true },
    );
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
  #chat{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
  .msg{max-width:78%;padding:10px 14px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}
  .msg.user{align-self:flex-end;background:var(--user);border:1px solid #1e4636}
  .msg.agent{align-self:flex-start;background:var(--panel2);border:1px solid var(--line)}
  .msg pre{background:#000;padding:10px;border-radius:8px;overflow-x:auto;font:12px/1.5 Consolas,monospace;white-space:pre}
  .msg code{font:12px Consolas,monospace;background:#000;padding:1px 5px;border-radius:4px}
  .msg.busy{color:var(--faint);font-style:italic}
  .dots span{animation:blink 1.2s infinite;border-radius:50%;display:inline-block;width:5px;height:5px;background:var(--accent);margin-right:3px}
  .dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}
  @keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
  footer{display:flex;gap:8px;padding:12px 18px;border-top:1px solid var(--line);background:var(--panel)}
  textarea{flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:var(--ink);padding:10px 12px;font:14px/1.4 inherit;resize:none}
  button{background:var(--accent);border:0;color:#00291c;font-weight:600;border-radius:10px;padding:0 18px;cursor:pointer}
  button:disabled{opacity:.4;cursor:default}
  .cerrar{background:none;border:1px solid var(--line);color:var(--faint);font-size:11px;padding:6px 10px}
</style></head><body>
<header>
  <h1 id="t">Chat con el agente</h1>
  <p id="sub"></p>
</header>
<div id="chat"></div>
<footer>
  <textarea id="q" rows="1" placeholder="Preguntale lo que quieras… (Enter envía, Shift+Enter salta línea)"></textarea>
  <button id="send">Enviar</button>
</footer>
<div style="padding:6px 18px 10px;background:var(--panel)"><button class="cerrar" id="quit">cerrar chat</button></div>
<script>
const chat=document.getElementById('chat'),q=document.getElementById('q'),send=document.getElementById('send');
let busy=false;
fetch('/info').then(r=>r.json()).then(i=>{
  document.getElementById('t').textContent='Chat con el agente'+(i.title?' — '+i.title:'');
  document.getElementById('sub').textContent=i.folder+' · responde con todo el contexto (~30-90s por respuesta)';
});
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
// Historial previo de la conversación: los mensajes ya intercambiados en
// ZCode (desktop o CLI), leídos de la DB local. Texto largo truncado a la
// vista (el texto completo queda en el tooltip).
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
async function ask(){
  const text=q.value.trim();
  if(!text||busy)return;
  busy=true;q.value='';q.disabled=true;send.disabled=true;
  bubble('user',esc(text));
  const b=bubble('agent busy','<span class="dots"><span></span><span></span><span></span></span> el agente está pensando…');
  try{
    const r=await fetch('/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:text})});
    const j=await r.json();
    b.className='msg agent';
    b.innerHTML=j.error?('<b style="color:#e55">error:</b> '+esc(j.error)):md(j.text||'(sin respuesta)');
  }catch(e){b.className='msg agent';b.innerHTML='<b style="color:#e55">error de conexión</b>';}
  busy=false;q.disabled=false;send.disabled=false;q.focus();
  chat.scrollTop=chat.scrollHeight;
}
send.onclick=ask;
q.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask();}});
document.getElementById('quit').onclick=()=>{fetch('/quit',{method:'POST'}).finally(()=>window.close());};
q.focus();
</script></body></html>`;
/* eslint-enable no-useless-escape */

// ---- Servidor ----
let busy = false;
let lastActivity = Date.now();
const server = http.createServer((req, res) => {
  lastActivity = Date.now();
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PAGE);
    return;
  }
  if (req.method === "GET" && req.url === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ title: sessionTitle, folder: workspacePath, session: sessionId }));
    return;
  }
  if (req.method === "GET" && req.url === "/history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ history: readHistory(sessionId) }));
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
      const child = spawn(
        process.execPath,
        [
          ZCODE_CLI,
          "-p",
          `Consulta de Cris sobre el trabajo ya entregado (solo respondé; no ejecutes cambios): ${question}`,
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
      child.on("error", (e) => {
        busy = false;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      });
      child.on("close", (code) => {
        busy = false;
        let text = null;
        try {
          const j = JSON.parse(stdout);
          text = typeof j.response === "string" ? j.response : null;
        } catch {}
        log(`respuesta (exit ${code}): ${text ? text.length + " chars" : "sin texto"}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: text ?? `La corrida terminó (código ${code}) sin respuesta textual — probá de nuevo.` }));
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
});

// Puerto libre en el rango, bind local únicamente.
let port = 43110;
const listen = () =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
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
  // Abrir el navegador con el chat (start abre el default).
  spawn("cmd", ["/c", "start", "", url], { windowsHide: true });
  // Auto-apagado por inactividad: no dejar servidores huérfanos.
  setInterval(() => {
    if (Date.now() - lastActivity > 30 * 60 * 1000) {
      log("idle timeout — chau");
      process.exit(0);
    }
  }, 60_000).unref();
})();
