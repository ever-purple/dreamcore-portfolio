/**
 * 访问日志埋点（前端侧）。
 *
 * 目的：**知道有没有面试官来看过作品集，以及他从哪条链接来、看了什么、待了多久。**
 *
 * 用法（只需要两处）：
 *   1. `recordEnter()`  —— 页面挂载时调一次，建一条访问记录。
 *   2. `setSections([...])` / `flush()` —— 切栏目时、离开页面时补写。
 *
 * 🔑 身份识别靠的是 **`?from=` 标记**，不是 IP：
 *    你投简历 / 发邮件时把链接写成
 *        https://www.everpurple.top/?from=某某公司
 *    面试官点开，后台就会记下「来源 = 某某公司」。
 *    IP 只用来查城市归属地做参考 —— 免费 IP 库在中国大陆经常偏，
 *    不要拿它当「是不是某家公司」的铁证。
 *
 * 设计取舍：
 *  · **绝不影响访客体验**：全部用 `keepalive` 的 fire-and-forget 请求，
 *    失败静默吞掉；不发任何提示、不加 loading。
 *  · **一个标签页 = 一条记录**：visitId 存 sessionStorage，刷新换新号（算新一次访问）。
 *  · 只在生产环境发（开发时刷页面不该污染真实日志）。
 */

const VISIT_ID_KEY = 'dreamcore.visitlog.id';
const SENT_KEY = 'dreamcore.visitlog.sent';
const API = '/api/visitlog';

/** 开发环境不发，避免本地调试把真实日志刷满 */
const ENABLED = import.meta.env.PROD;

/** 本次访问看过的栏目（顺序即浏览顺序，去重） */
let sections: string[] = [];
/** 本次访问的关键动作（如「简历下载」）—— 比「来过」更有判断力 */
let events: string[] = [];
/** 进入时间 */
let enteredAt = Date.now();
/** 是否已经建过记录 */
let created = false;
/** 已经 flush 过就不重复发 */
let flushed = false;

function readParam(name: string): string {
  try {
    return (new URLSearchParams(window.location.search).get(name) ?? '').trim().slice(0, 60);
  } catch {
    return '';
  }
}

function getVisitId(): string {
  try {
    const prev = window.sessionStorage.getItem(VISIT_ID_KEY);
    if (prev) return prev;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(VISIT_ID_KEY, id);
    return id;
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** fire-and-forget：失败一律吞掉，绝不打扰访客 */
function post(payload: Record<string, unknown>, useKeepalive: boolean) {
  if (!ENABLED) return;
  try {
    void fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: useKeepalive,
      cache: 'no-store',
    }).catch(() => {
      /* 静默 */
    });
  } catch {
    /* 静默 */
  }
}

/** 站外来路（面试官从招聘网站 / 邮件客户端点进来的话能看到） */
function referrerHost(): string {
  try {
    if (!document.referrer) return '';
    const u = new URL(document.referrer);
    return u.hostname === window.location.hostname ? '' : u.hostname.slice(0, 100);
  } catch {
    return '';
  }
}

/**
 * 建一条访问记录。页面挂载时调一次即可。
 * @param route 落地路由标记，如 'home' / 'studio' / 'about'
 */
export function recordEnter(route: string) {
  if (!ENABLED) return;
  if (created) return;
  created = true;
  enteredAt = Date.now();

  // 同一个标签页刷新时不会重发，避免一次访问记成多条
  try {
    if (window.sessionStorage.getItem(SENT_KEY) === '1') return;
    window.sessionStorage.setItem(SENT_KEY, '1');
  } catch {
    /* 隐私模式：照样发，最坏是多记一条 */
  }

  post(
    {
      visitId: getVisitId(),
      from: readParam('from') || readParam('utm_source'),
      ref: referrerHost(),
      path: route,
    },
    false,
  );
}

/** 补写一次当前状态（栏目 + 动作 + 停留时长） */
function pushPatch(useKeepalive: boolean) {
  post(
    { visitId: getVisitId(), sections, events, dwell: dwellSec() },
    useKeepalive,
  );
}

/** 记一个看过的栏目（去重、保序）。传导航 id，如 'intro' / 'inspiration' */
export function markSection(id: string) {
  if (!ENABLED) return;
  if (!id || sections.includes(id)) return;
  sections = [...sections, id];
  // 每切一次就补写一次，这样即使访客直接关掉浏览器，也已经留下轨迹
  pushPatch(true);
}

/**
 * 记一个关键动作。目前用在**简历下载**上 ——
 * 「来过」和「下载了简历」完全是两码事，后者才是真在考虑你。
 */
export function markEvent(name: string) {
  if (!ENABLED) return;
  if (!name || events.includes(name)) return;
  events = [...events, name];
  pushPatch(true);
}

/** 已停留秒数 */
function dwellSec(): number {
  return Math.max(0, Math.round((Date.now() - enteredAt) / 1000));
}

/**
 * 离开页面时补报停留时长 + 完整栏目轨迹 + 动作。
 * 幂等：重复调用只发一次。
 */
export function flush() {
  if (!ENABLED || flushed) return;
  flushed = true;
  pushPatch(true);
}

let wired = false;

/**
 * 装好「离开时自动上报」。调用一次即可，内部会防重复注册。
 *  · pagehide / beforeunload —— 关标签页、跳外链
 *  · visibilitychange → hidden —— 切到别的 App、手机切后台（比 beforeunload 可靠）
 */
export function wireExitFlush() {
  if (!ENABLED || wired) return;
  wired = true;

  window.addEventListener('pagehide', () => flush());
  window.addEventListener('beforeunload', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
