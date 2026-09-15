// Headless verification for 神州租车 detail page restructure.
// Launches nothing — assumes Edge is already on :9334 (started separately).
const WS = globalThis.WebSocket;
const BASE = 'http://127.0.0.1:5199';
const URL = `${BASE}/?studio=1&works=1`;

let seq = 0;
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id === id) {
        ws.removeListener('message', onMsg);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ver = await (await fetch('http://127.0.0.1:9334/json/version')).json();
  const ws = new WS(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  const errors = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
    }
  });

  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  await cdp(ws, 'Page.navigate', { url: URL });
  await sleep(2500);

  // wait for works wheel items
  let ok = false;
  for (let i = 0; i < 30; i++) {
    const n = await cdp(ws, 'Runtime.evaluate', { expression: 'document.querySelectorAll(".ww-item").length', returnByValue: true });
    if (n.result.value >= 2) { ok = true; break; }
    await sleep(500);
  }
  if (!ok) { console.log('FAIL: .ww-item not found'); process.exit(1); }

  // click 神州租车 (index 1)
  await cdp(ws, 'Runtime.evaluate', { expression: 'document.querySelectorAll(".ww-item")[1].click()', returnByValue: true });

  // wait for detail page
  for (let i = 0; i < 30; i++) {
    const n = await cdp(ws, 'Runtime.evaluate', { expression: 'document.querySelectorAll(".wkp").length', returnByValue: true });
    if (n.result.value >= 1) break;
    await sleep(500);
  }

  await sleep(1200);

  const report = await cdp(ws, 'Runtime.evaluate', {
    expression: `(function(){
      const out = {};
      out.navItems = document.querySelectorAll('.wkp-nav-item').length;
      out.grid2 = document.querySelectorAll('.wkp-figs.is-grid2').length;
      out.cols = document.querySelectorAll('.wkp-cols').length;
      out.colCount = document.querySelectorAll('.wkp-col').length;
      out.colTitles = Array.from(document.querySelectorAll('.wkp-col-title')).map(e=>e.textContent.trim());
      out.colImgs = document.querySelectorAll('.wkp-cols img').length;
      // grid2 images per block (in DOM order)
      out.grid2Imgs = Array.from(document.querySelectorAll('.wkp-figs.is-grid2')).map(g=>g.querySelectorAll('img').length);
      // any image still using object-fit:cover inside figs?
      out.figCover = Array.from(document.querySelectorAll('.wkp-figs img')).filter(i=>getComputedStyle(i).objectFit==='cover').length;
      out.stepCover = Array.from(document.querySelectorAll('.wkp-step-figs img')).filter(i=>getComputedStyle(i).objectFit==='cover').length;
      // sample srcs
      out.colsSample = Array.from(document.querySelectorAll('.wkp-cols img')).slice(0,4).map(i=>i.getAttribute('src'));
      out.bgSample = Array.from(document.querySelectorAll('.wkp-figs.is-grid2 img')).slice(0,4).map(i=>i.getAttribute('src'));
      // 创意作业三步区（2026-09-15 改版后）
      out.stepsH2 = document.querySelector('.wkp-steps .wkp-h2')?.textContent.trim() ?? '';
      out.stepTitles = Array.from(document.querySelectorAll('.wkp-step-title')).map(e=>e.textContent.trim());
      out.stepCount = document.querySelectorAll('.wkp-step').length;
      out.stepImgs = document.querySelectorAll('.wkp-step-figs img').length;
      return out;
    })()`,
    returnByValue: true,
  });

  const r = report.result.value;
  console.log('--- 神州租车 detail report ---');
  console.log(JSON.stringify(r, null, 2));
  console.log('--- console errors:', errors.length);
  errors.slice(0, 10).forEach((e) => console.log('  ', e));

  // assertions（2026-09-15 创意作业改三步版式后：grid2 剩 2 组；订阅号删 3 张剩 4 张；三步区=创意作业）
  const A = [];
  A.push(['navItems=4 (3板块+创意作业)', r.navItems === 4]);
  A.push(['grid2=2', r.grid2 === 2]);
  A.push(['cols=1', r.cols === 1]);
  A.push(['colCount=4', r.colCount === 4]);
  A.push(['colTitles ok', JSON.stringify(r.colTitles) === JSON.stringify(['服务号','订阅号','微博','小红书 & 短视频'])]);
  A.push(['colImgs=15', r.colImgs === 15]);
  A.push(['grid2Imgs=[4,2]', JSON.stringify(r.grid2Imgs) === JSON.stringify([4,2])]);
  A.push(['stepsH2=创意作业', r.stepsH2 === '创意作业 · 把节点做成梗']);
  A.push(['stepTitles=老乡车队/十一/苏超', JSON.stringify(r.stepTitles) === JSON.stringify(['老乡车队','十一 · 伴手礼集市','苏超借势'])]);
  A.push(['stepCount=3', r.stepCount === 3]);
  A.push(['stepImgs=8', r.stepImgs === 8]);
  A.push(['no fig cover', r.figCover === 0]);
  A.push(['no step cover', r.stepCover === 0]);
  A.push(['no console errors', errors.length === 0]);
  console.log('--- assertions ---');
  let allPass = true;
  for (const [name, pass] of A) { console.log((pass?'PASS':'FAIL')+'  '+name); if(!pass) allPass=false; }
  console.log(allPass ? 'ALL_PASS' : 'SOME_FAIL');

  ws.close();
  process.exit(allPass ? 0 : 2);
}
main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(3); });
