/**
 * perf-test.mjs — headless Chrome CDP performance measurement for garden planner.
 * Node 22 built-ins only (no npm installs).  Run: node perf-test.mjs
 */
'use strict';
import http from 'http';
import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { spawn } from 'child_process';

// ── config ────────────────────────────────────────────────────────────────────
const GARDEN_DIR = String.raw`c:\Users\j.vailles\MyData\Git\garden-planner`;
const HTTP_PORT  = 18765;
const CDP_PORT   = 19222;
const CHROME     = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
// ─────────────────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── test data ─────────────────────────────────────────────────────────────────
// Real plant IDs from data.js. Cells are arrays of entry objects matching
// the store's actual bed shape: { "r,c": [{ plantId, instanceId, lifecycle }] }
function makeTestBeds() {
  const plantIds = ['tomato','lettuce','carrot','spinach','radish','kale','onion','garlic','broccoli','pepper'];

  function makeBed(id, name, cols, rows) {
    const cells = {};
    let instCounter = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r * cols + c) % 9 < 5) {  // ~55% fill rate
          const plantId = plantIds[(r + c) % plantIds.length];
          cells[`${r},${c}`] = [{
            plantId,
            instanceId: `i${++instCounter}`,
            lifecycle: ['planned','growing','transplanted','harvested_once'][(r+c)%4],
          }];
        }
      }
    }
    return { id, name, widthM: cols * 0.1, heightM: rows * 0.1, cols, rows, cells };
  }

  return [
    makeBed('bed-a', 'Raised Bed A',  30, 20),  // 600 cells
    makeBed('bed-b', 'Raised Bed B',  25, 15),  // 375 cells
    makeBed('bed-c', 'Herb Garden',   20, 10),  // 200 cells
    makeBed('bed-d', 'Polytunnel',    40, 12),  // 480 cells
  ];
}

// ── static server ─────────────────────────────────────────────────────────────
async function startServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const fp  = path.resolve(GARDEN_DIR, rel === '/' ? 'index.html' : rel.slice(1));
    if (!fp.startsWith(GARDEN_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const mime = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise(r => server.listen(HTTP_PORT, '127.0.0.1', r));
  console.log(`  [server] http://127.0.0.1:${HTTP_PORT}`);
  return server;
}

// ── CDP session ───────────────────────────────────────────────────────────────
async function cdpSession() {
  // Get page target WS URL
  let targets;
  for (let attempts = 0; attempts < 10; attempts++) {
    try { targets = await httpGet(CDP_PORT, '/json/list'); break; }
    catch { await sleep(500); }
  }
  const target = Array.isArray(targets) ? targets.find(t => t.type === 'page') : null;
  if (!target) throw new Error('No CDP page target found after 5s');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
    setTimeout(() => rej(new Error('WS open timeout')), 8000);
  });

  let id = 0;
  const pending = new Map();

  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.rej(msg.error) : p.res(msg.result ?? {}); }
    }
  });

  function cmd(method, params = {}) {
    const cid = ++id;
    return new Promise((res, rej) => {
      pending.set(cid, { res, rej });
      ws.send(JSON.stringify({ id: cid, method, params }));
    });
  }

  return { cmd, ws };
}

// ── metric snapshot ───────────────────────────────────────────────────────────
async function snap(cmd) {
  const { metrics } = await cmd('Performance.getMetrics');
  return Object.fromEntries(metrics.map(m => [m.name, m.value]));
}

function delta(before, after) {
  const d = {};
  for (const k of Object.keys(after)) d[k] = (after[k] ?? 0) - (before[k] ?? 0);
  return d;
}

const COLS = ['RecalcStyleCount','RecalcStyleDuration','LayoutCount','LayoutDuration',
              'UpdateLayerTreeDuration','PaintCount','PaintDuration','CompositeDuration',
              'ScriptDuration','TaskDuration'];

function report(label, d) {
  console.log(`\n  ┌─ ${label}`);
  for (const k of COLS) {
    const v = d[k];
    if (!v || v < 0.0001) continue;
    const val = k.endsWith('Duration') ? `${(v * 1000).toFixed(1).padStart(8)} ms` : `${Math.round(v).toString().padStart(8)}   `;
    console.log(`  │  ${k.padEnd(26)} ${val}`);
  }
  console.log(`  └${'─'.repeat(42)}`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Garden Planner — CDP Performance Test   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const server = await startServer();

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${path.join(os.tmpdir(), 'gp-cdp-perf')}`,
    '--window-size=1600,900',
  ], { stdio: 'ignore' });

  console.log('  [chrome] launched — waiting for CDP...');
  await sleep(2500);

  try {
    const { cmd, ws } = await cdpSession();
    await cmd('Runtime.enable');
    await cmd('Performance.enable', { timeDomain: 'timeTicks' });

    // ── load the app, then inject beds via Store.importAll + Beds.init ───────
    // addScriptToEvaluateOnNewDocument doesn't persist localStorage across the
    // navigation to the real origin, so we navigate first, then inject.
    console.log('  [test] loading app...');
    await cmd('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
    await cmd('Runtime.evaluate', {
      expression: `new Promise(r => { if (document.readyState === 'complete') setTimeout(r, 500); else window.addEventListener('load', () => setTimeout(r, 500)); })`,
      returnByValue: false,
      awaitPromise: true,
      timeout: 12000,
    });
    await sleep(300);

    // Inject test beds via Store.importAll() which updates in-memory cache +
    // localStorage, then call switchTab('beds') → Beds.init() to re-render.
    const beds = makeTestBeds();
    const snapshot = JSON.stringify({ version: 5, beds, customPlants: [], builtins: {}, inventory: [], settings: {}, bedHistory: [], lifecycleJournal: [] });
    await cmd('Runtime.evaluate', {
      expression: `Store.importAll(${JSON.stringify(snapshot)}); switchTab('beds');`,
      returnByValue: true,
    });
    // wait for Beds.init() to finish painting
    await sleep(1500);

    const debug = await cmd('Runtime.evaluate', {
      expression: `JSON.stringify({ bedBlocks: document.querySelectorAll('.bed-block').length, gcells: document.querySelectorAll('.gcell').length })`,
      returnByValue: true,
    });
    console.log(`  [debug] ${debug.result?.value ?? 'N/A'}`);

    console.log('  [test] measuring initial render with 4 beds (1,655 cells total)...');
    const t0 = Date.now();
    const m0 = await snap(cmd);

    // Trigger a full re-render — this is the "initial render" baseline.
    await cmd('Runtime.evaluate', {
      expression: `Beds.init(); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
      returnByValue: false,
      awaitPromise: true,
      timeout: 10000,
    });
    await sleep(500);

    const m1  = await snap(cmd);
    const loadMs = Date.now() - t0;

    const cellCount = await cmd('Runtime.evaluate', { expression: `document.querySelectorAll('.gcell').length`, returnByValue: true });
    console.log(`  [page] ${cellCount.result?.value ?? '?'} gcell elements, render took ~${loadMs} ms`);
    report('Beds.init() full render', delta(m0, m1));

    // ── measure scroll ───────────────────────────────────────────────────────
    console.log('\n  [test] scrolling 600 px down then back...');
    const m2 = await snap(cmd);

    await cmd('Runtime.evaluate', {
      expression: `
        (async () => {
          const el = document.querySelector('.bed-canvas-area');
          if (!el) return 'no canvas';
          for (let i = 0; i < 60; i++) { el.scrollTop += 10; await new Promise(r => requestAnimationFrame(r)); }
          await new Promise(r => setTimeout(r, 200));
          for (let i = 0; i < 60; i++) { el.scrollTop -= 10; await new Promise(r => requestAnimationFrame(r)); }
          await new Promise(r => setTimeout(r, 200));
          return 'done';
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });
    await sleep(300);

    const m3 = await snap(cmd);
    report('Scroll 600 px down+up (120 frames)', delta(m2, m3));

    // ── measure renderCanvas: full vs per-bed ─────────────────────────────────
    // Full render: rare operation (undo/redo, bed add/delete).
    console.log('\n  [test] calling Beds.renderCanvas() full × 5...');
    const m4 = await snap(cmd);

    await cmd('Runtime.evaluate', {
      expression: `(function() { for (let i=0;i<5;i++) Beds.renderCanvas(); return 'ok'; })()`,
      returnByValue: true,
    });
    await sleep(300);
    const m5 = await snap(cmd);
    report('renderCanvas() full × 5', delta(m4, m5));

    // Per-bed render: the common case (plant placement, removal, lifecycle).
    console.log('\n  [test] calling Beds.renderCanvas({ bedId }) × 5 (bed-a: 600 cells)...');
    const m4b = await snap(cmd);

    await cmd('Runtime.evaluate', {
      expression: `(function() { for (let i=0;i<5;i++) Beds.renderCanvas({ bedId:'bed-a' }); return 'ok'; })()`,
      returnByValue: true,
    });
    await sleep(300);
    const m5b = await snap(cmd);
    report('renderCanvas({ bedId }) × 5', delta(m4b, m5b));

    // ── measure rapid hover over cells ───────────────────────────────────────
    console.log('\n  [test] simulating rapid mouseover across cells...');
    const m6 = await snap(cmd);

    await cmd('Runtime.evaluate', {
      expression: `
        (async () => {
          const cells = Array.from(document.querySelectorAll('.gcell')).slice(0, 200);
          for (const el of cells) {
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseout',  { bubbles: true, cancelable: true }));
            if (cells.indexOf(el) % 20 === 0) await new Promise(r => requestAnimationFrame(r));
          }
          return 'done ' + cells.length + ' cells';
        })()
      `,
      returnByValue: true,
      awaitPromise: true,
    });
    await sleep(200);

    const m7 = await snap(cmd);
    report('mouseover/mouseout × 200 cells', delta(m6, m7));

    // ── summary ──────────────────────────────────────────────────────────────
    console.log('\n  ═══════════════ SUMMARY ═══════════════');
    const scrollD    = delta(m2, m3);
    const renderFullD = delta(m4, m5);
    const renderBedD  = delta(m4b, m5b);
    const hoverD     = delta(m6, m7);
    const perFull   = (renderFullD.TaskDuration ?? 0) / 5 * 1000;
    const perBed    = (renderBedD.TaskDuration  ?? 0) / 5 * 1000;
    const perScroll = (scrollD.RecalcStyleDuration ?? 0) / 120 * 1000;
    const perHover  = (hoverD.ScriptDuration ?? 0) / 200 * 1000;
    console.log(`  renderCanvas() full cost     : ${perFull.toFixed(1)} ms/call (4 beds, 1655 cells)`);
    console.log(`  renderCanvas({ bedId }) cost : ${perBed.toFixed(1)} ms/call (1 bed, 600 cells)`);
    console.log(`  RecalcStyle per scroll frame : ${perScroll.toFixed(3)} ms`);
    console.log(`  Script per hover event       : ${perHover.toFixed(3)} ms`);
    console.log(`  Layerize during scroll       : ${((scrollD.UpdateLayerTreeDuration ?? 0) * 1000).toFixed(1)} ms total`);
    console.log('  ════════════════════════════════════════\n');

    ws.close();
  } finally {
    chrome.kill();
    server.close();
  }
}

main().catch(e => { console.error('\n[FATAL]', e.message); process.exit(1); });
