/**
 * 无头验证：报刊亭顶层三件设备（DVD 机 / DV 机 / MP3）
 *
 * 为什么不用截图当主证据：本机是 SwiftShader 软渲染，18MB 展架 + 3×7.5 万面设备
 * 出图又慢又糊，「MP3 是不是放倒了」「正面有没有朝镜头」这种量级的问题肉眼判不准。
 * 所以主证据走 `?nsfit=1` 探针读**搁板坐标系下的真实包围盒 + 姿态角 + 正面法线**，
 * 再用真实鼠标事件（Input.dispatchMouseEvent）走一遍射线拾取全链路。
 *
 * ⚠️ URL 里 `studio=1` 不能省：本站是滚动驱动，首页 → 工作室要滚到才挂载。
 * 只写 `?newsstand=1` 的话 StudioSection 根本不渲染，探针永远等不到 __NSREADY。
 *
 * ⚠️ 必须自建隔离标签页：该调试端口下同时存在扩展页等多个 target，
 * `list.find(t => t.type === 'page')` 会抓到 AdGuard 欢迎页。
 *
 * 用法：先起预览服务，再起无头 Edge（见 headless-web-verify skill），然后：
 *   node scripts/verify-newsstand-devices.mjs   （ws 已是 devDependency）
 *
 * 配套：scripts/yawscan-device-facing.mjs（扫模型正面朝向）
 *       scripts/compose-yaw.py（把四朝向拼成对比图）
 *       scripts/compress-devices.sh（原始大模型 → webp+meshopt 压缩）
 */
import WebSocket from 'ws';
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9333';
const PAGE = 'http://127.0.0.1:4180/?studio=1&newsstand=1&nsfit=1';

/* 搁板坐标系常量（与 NewsstandScene.tsx 的注释同源） */
const DEVICE_Y = 0.74;
const CEIL_Y = 0.92;
const SHELF_X = [-0.2065, 0.2126];
const SHELF_Z = [-0.0721, 0.0548];
const DEVICE_LIFT = 0.028;
const DEVICE_SCALE = 1.14;

/** 期望的从左到右顺序 + 期望的「正面朝镜头」角度 */
const ORDER = ['dvd.glb', 'dv.glb', 'mp3.glb'];
const NAMES = { 'dvd.glb': 'DVD 机', 'dv.glb': 'DV 机', 'mp3.glb': 'MP3' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const created = await (await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  const targetId = created.id;
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });

  let id = 0;
  const pending = new Map();
  const timeouts = [];
  const dialogs = [];
  const bad = [];
  const logs = [];

  ws.on('message', (buf) => {
    const m = JSON.parse(buf.toString());
    if (m.method === 'Page.javascriptDialogOpening') {
      dialogs.push(m.params.message);
      ws.send(JSON.stringify({ id: ++id, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
      return;
    }
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400) bad.push(`${r.status} ${m.params.type} ${r.url}`);
    }
    if (m.method === 'Network.loadingFailed') bad.push(`FAILED ${m.params.errorText}`);
    if (m.method === 'Log.entryAdded') logs.push(`[${m.params.entry.level}] ${m.params.entry.text}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`[EXCEPTION] ${m.params.exceptionDetails.exception?.description || ''}`);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });

  const send = (method, params = {}, ms = 30000) =>
    new Promise((res) => {
      const mid = ++id;
      const t = setTimeout(() => {
        pending.delete(mid);
        timeouts.push(method);
        res({ __timeout: true });
      }, ms);
      pending.set(mid, (m) => {
        clearTimeout(t);
        res(m);
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const ev = async (expr, ms) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
    if (r.__timeout) return { __timeout: true };
    const ex = r.result?.exceptionDetails;
    if (ex) return { __error: ex.exception?.description || ex.text };
    return r.result?.result?.value;
  };

  return {
    send,
    ev,
    targetId,
    close: () => {
      ws.close();
      fetch(`${CDP}/json/close/${targetId}`).catch(() => {});
    },
    state: () => ({ timeouts, dialogs, bad, logs }),
  };
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + detail : ''}`);
};

(async () => {
  const c = await connect();
  const { send, ev } = c;

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Log.enable');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  console.log('navigate ->', PAGE);
  await send('Page.navigate', { url: PAGE });

  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 240000) {
    const r = await ev('window.__NSREADY === true', 8000);
    if (r === true) { ready = true; break; }
    await sleep(1500);
  }
  console.log(`ready=${ready}  after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check('场景就绪（展架 + 3 设备全部放置）', ready, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!ready) {
    console.log('bodyText =', await ev('(document.body.innerText||"").replace(/\\s+/g," ").slice(0,200)'));
    console.log('NSFIT =', await ev('window.__NSFIT ? JSON.stringify(window.__NSFIT).slice(0,400) : null'));
    console.log('state =', JSON.stringify(c.state()));
    c.close();
    process.exit(1);
  }

  // 指针停到角落，排除悬停姿态干扰
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890, pointerType: 'mouse' });
  await sleep(700);

  const data = JSON.parse(await ev('JSON.stringify(window.__NSFIT)'));
  console.log('\n=== RAW __NSFIT ===');
  console.log(JSON.stringify(data, null, 1));

  const devs = data.items
    .filter((it) => ORDER.includes(it.label))
    .sort((a, b) => a.x[0] - b.x[0]);
  const books = data.items.filter((it) => it.kind === 'book');
  const get = (label) => devs.find((d) => d.label === label);

  check('设备数量 = 3', devs.length === 3, `devices=${devs.length} books=${books.length}`);
  check(
    '左→右 依次为 DVD 机 / DV 机 / MP3',
    devs.length === 3 && devs.every((d, i) => d.label === ORDER[i]),
    devs.map((d) => `${NAMES[d.label]} x∈[${d.x[0]}, ${d.x[1]}]`).join('  '),
  );
  const gaps = devs.slice(1).map((d, i) => +(d.x[0] - devs[i].x[1]).toFixed(4));
  check('三件设备互不重叠', gaps.every((g) => g > 0), `相邻间距 = ${gaps.join(', ')}`);

  const seat = devs.map((d) => +Math.abs(d.y[0] - DEVICE_Y).toFixed(4));
  check('底座落在台面 y=0.74', seat.every((e) => e < 0.004), `最大偏差 = ${Math.max(...seat)}`);

  const tops = devs.map((d) => d.y[1]);
  check(
    '静止时高度 + 悬停抬升不穿天花板 y=0.92',
    tops.every((t) => t + DEVICE_LIFT < CEIL_Y),
    devs.map((d) => `${NAMES[d.label]}=${(d.y[1] + DEVICE_LIFT).toFixed(4)}`).join(' ') + `  (天花板 ${CEIL_Y})`,
  );

  const inShelf = devs.every(
    (d) =>
      d.x[0] >= SHELF_X[0] - 0.005 && d.x[1] <= SHELF_X[1] + 0.005 &&
      d.z[0] >= SHELF_Z[0] - 0.01 && d.z[1] <= SHELF_Z[1] + 0.01,
  );
  check('全部落在搁板可用范围内', inShelf, devs.map((d) => `${NAMES[d.label]} z∈[${d.z[0]}, ${d.z[1]}]`).join('  '));

  /* ---------- 正面朝向：正面法线必须指向 +Z（相机在 +Z 看向原点） ---------- */
  console.log('\n=== 正面朝向（front.z 应接近 +1） ===');
  devs.forEach((d) => console.log(`  ${NAMES[d.label]} front = (${d.front.x}, ${d.front.y}, ${d.front.z})`));
  check(
    '三件设备正面都朝向镜头（front.z > 0.9 且 |front.x| < 0.35）',
    devs.every((d) => d.front && d.front.z > 0.9 && Math.abs(d.front.x) < 0.35),
    devs.map((d) => `${NAMES[d.label]}:z=${d.front?.z}`).join(' '),
  );

  /* ---------- MP3 姿态：不是竖直的 ---------- */
  const mp3 = get('mp3.glb');
  check(
    'MP3 处于「放倒 + 微倾」（roll 侧倒 45°~90°，非竖直）',
    Math.abs(mp3.restRollDeg) > 45 && Math.abs(mp3.restRollDeg) < 90,
    `roll=${mp3.restRollDeg}°  pitch=${mp3.restPitchDeg}°  静止高度=${(mp3.y[1] - mp3.y[0]).toFixed(4)}`,
  );
  check(
    'DVD / DV 竖直摆放',
    Math.abs(get('dvd.glb').restRollDeg) < 1 && Math.abs(get('dv.glb').restRollDeg) < 1,
    `DVD roll=${get('dvd.glb').restRollDeg}°  DV roll=${get('dv.glb').restRollDeg}°`,
  );

  /* ---------- 悬停：走真实鼠标事件（射线拾取全链路） ---------- */
  console.log('\n=== 真实鼠标悬停（CDP 真事件 → 射线拾取） ===');
  const reports = [];
  for (const d of devs) {
    const at = JSON.parse((await ev(`JSON.stringify(window.__NSAT(${d.i}))`)) || 'null');
    if (!at) { check(`悬停 ${NAMES[d.label]}：拿到屏幕坐标`, false, 'null'); continue; }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 880, pointerType: 'mouse' });
    await sleep(900);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, pointerType: 'mouse' });
    await sleep(1600);
    const one = JSON.parse(await ev('JSON.stringify(window.__NSFIT)'));
    const it = one.items[d.i];
    const others = one.items.filter((o) => o.i !== d.i).map((o) => +o.lift.toFixed(5));
    reports.push({ label: d.label, at, it, othersMax: Math.max(...others) });
    console.log(
      `  ${NAMES[d.label]} @(${at.x},${at.y})  lift=${it.lift.toFixed(5)}/${DEVICE_LIFT}  ` +
        `scale=${it.scaleNow}/${(it.baseScale * DEVICE_SCALE).toFixed(4)}  ` +
        `pitch ${it.restPitchDeg}°→${it.pitchNowDeg}°  roll ${it.restRollDeg}°→${it.rollNowDeg}°  ` +
        `front.z=${it.front?.z}  maxY=${it.y[1].toFixed(4)}  其他件 maxLift=${Math.max(...others).toFixed(5)}`,
    );
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 880, pointerType: 'mouse' });
    await sleep(1300);
  }

  check('鼠标真移到设备上 → 该件被抽离抬起', reports.length === 3 && reports.every((r) => r.it.lift > 0.026),
    reports.map((r) => `${NAMES[r.label]}=${r.it.lift.toFixed(4)}`).join(' '));
  check('悬停时其余物件保持复位', reports.every((r) => r.othersMax < 0.001),
    reports.map((r) => `${NAMES[r.label]}:${r.othersMax.toFixed(4)}`).join(' '));
  check('悬停时前抽 + 放大', reports.every((r) => r.it.y[0] > DEVICE_Y + 0.02 && r.it.scaleNow > r.it.baseScale * 1.1),
    reports.map((r) => `${NAMES[r.label]} y0=${r.it.y[0].toFixed(4)} s=${r.it.scaleNow}`).join(' '));
  /**
   * 悬停目标姿态（与 DEVICE_SLOTS 的 hoverPitch/hoverRoll 同源）：
   * DVD/DV 本来就正，悬停不变；MP3 用户要求「不用这么竖，45° 就行」→ 从 -78° 站起到 -45°。
   */
  const hoverRollExpect = { 'dvd.glb': 0, 'dv.glb': 0, 'mp3.glb': -45 };
  check(
    '悬停姿态到达设定目标（MP3 只站起到 -45°，不是 0°）',
    reports.every((r) => Math.abs(r.it.rollNowDeg - hoverRollExpect[r.label]) < 3),
    reports.map((r) => `${NAMES[r.label]} ${r.it.restRollDeg}°→${r.it.rollNowDeg}°(期望${hoverRollExpect[r.label]}°)`).join(' '),
  );
  check('立起来后正面仍朝镜头', reports.every((r) => r.it.front?.z > 0.9),
    reports.map((r) => `${NAMES[r.label]}:z=${r.it.front?.z}`).join(' '));
  check('立正 + 抬升后仍不穿天花板', reports.every((r) => r.it.y[1] < CEIL_Y),
    reports.map((r) => `${NAMES[r.label]} maxY=${r.it.y[1].toFixed(4)}`).join(' '));

  /* ---------- 截图 ---------- */
  const shot = await send('Page.captureScreenshot', { format: 'png' }, 240000);
  if (shot.result?.data) {
    fs.writeFileSync('_newsstand-devices.png', Buffer.from(shot.result.data, 'base64'));
    console.log('\nscreenshot -> _newsstand-devices.png');
  } else {
    console.log('\nscreenshot failed');
  }

  const st = c.state();
  console.log('\n=== state ===');
  console.log('timeouts =', JSON.stringify(st.timeouts));
  console.log('dialogs  =', JSON.stringify(st.dialogs));
  console.log('badNet   =', JSON.stringify(st.bad));
  console.log('errors   =', JSON.stringify(st.logs.filter((l) => l.startsWith('[error') || l.startsWith('[EXCEPTION'))).slice(0, 500));

  console.log('\n=== summary ===');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.name).join(' | '));

  c.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
