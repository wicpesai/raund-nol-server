// Сервер «Раунд Ноль»: комнаты по коду, быстрая игра, пересылка сообщений между двумя игроками.
const http = require('http');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Round Zero server OK'); });
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();   // code -> { host, guest }
let waiting = null;        // ожидающий в быстрой игре

const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => ALPHA[Math.random() * ALPHA.length | 0]).join(''); } while (rooms.has(c)); return c; };

function leave(ws) {
  if (waiting === ws) waiting = null;
  const r = rooms.get(ws.room);
  if (!r) return;
  const other = r.host === ws ? r.guest : r.host;
  send(other, { t: 'peer_left' });
  if (other) { other.room = null; other.peer = null; }
  rooms.delete(ws.room);
  ws.room = null; ws.peer = null;
}

wss.on('connection', ws => {
  ws.alive = true; ws.room = null; ws.peer = null;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'host') {
      leave(ws);
      const code = newCode(); rooms.set(code, { host: ws, guest: null }); ws.room = code;
      send(ws, { t: 'hosted', code });
    } else if (m.t === 'join') {
      leave(ws);
      const code = String(m.code || '').toUpperCase().trim(), r = rooms.get(code);
      if (!r || r.guest) return send(ws, { t: 'err', m: r ? 'Комната занята' : 'Комната не найдена' });
      r.guest = ws; ws.room = code; ws.peer = r.host; r.host.peer = ws;
      send(r.host, { t: 'joined' }); send(ws, { t: 'joined' });
    } else if (m.t === 'quick') {
      leave(ws);
      if (waiting && waiting.readyState === 1) {
        const h = waiting; waiting = null;
        const code = newCode(); rooms.set(code, { host: h, guest: ws });
        h.room = ws.room = code; h.peer = ws; ws.peer = h;
        send(h, { t: 'matched', role: 'host', code }); send(ws, { t: 'matched', role: 'guest', code });
      } else { waiting = ws; send(ws, { t: 'waiting' }); }
    } else if (m.t === 'cancel') {
      leave(ws);
    } else if (ws.peer) {
      send(ws.peer, m);   // всё остальное просто пересылаем второму игроку
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// не даём соединениям зависать и не даём Render усыпить активные игры
setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; try { ws.ping(); } catch (e) {} });
}, 25000);

server.listen(process.env.PORT || 8080, () => console.log('Server on', process.env.PORT || 8080));