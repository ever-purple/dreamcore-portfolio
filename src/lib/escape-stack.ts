import { useEffect, useRef } from 'react';

/**
 * 全站统一 ESC 栈（2026-09-16，第一档改造 ③）。
 *
 * ## 为什么要重做
 * 以前每个浮层各自 `window.addEventListener('keydown')` —— 谁后挂谁先跑，
 * 而且**所有**监听都会跑到。于是：
 *   · 书架还挂在落地页底下时，一按 Esc 两个一起关（NewsstandScene 只好加了个
 *     `covered` 标志专门绕开）；
 *   · Green OS 的开始菜单得手动 stopPropagation，才能只收菜单不关整页；
 *   · 木马详情页和木马页都得靠"谁先 return"来抢。
 * 这套隐式顺序没人说得清，加一个浮层就得重新验一遍。
 *
 * ## 现在
 * 显式的**栈**：谁最后挂上谁先响应，命中即停，一次按键只走一个处理器。
 * 挂载顺序天然等于视觉层级 —— 因为浮层就是在各自的 useEffect 里按"打开"的顺序挂的。
 *
 * ## 为什么是捕获阶段 + stopImmediatePropagation
 * keydown 的传播路径是「捕获：window → … → target，冒泡：target → … → window」。
 * 在 window 上挂捕获监听，是整条链里**第一个**执行的；这时调
 * `stopImmediatePropagation()` 会连 window 上同一目标的其它监听一起掐掉，
 * 也掐掉后续所有节点 —— 于是这套栈是**唯一权威**，不会被谁 sneak in。
 * （用 `stopPropagation()` 不够：它不拦同一目标上的其它监听。）
 *
 * ⚠️ 副作用：一旦栈里有人，其它**没迁移**的裸 `keydown` Esc 监听就全哑了。
 * 所以迁移是"全有或全无"的 —— 新增浮层请一律用 `useEscape`，别再手写监听。
 * 排查方式：`grep -rn "Escape" src/`，除本文件外不该再有第二处。
 */

type Handler = () => void;

/** 栈：末尾是当前最上层（最后挂上）的处理器 */
const stack: Handler[] = [];

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (!top) return; // 栈空 = 没人管 Esc，放行给浏览器（比如退出全屏）
  e.preventDefault();
  e.stopImmediatePropagation();
  top();
};

/**
 * 把一个 Esc 处理器压栈。返回出栈函数（卸载时调用）。
 * 一般不用直接调，用下面的 `useEscape`。
 */
export function pushEscape(handler: Handler): () => void {
  stack.push(handler);
  if (stack.length === 1) window.addEventListener('keydown', onKeyDown, true);
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) window.removeEventListener('keydown', onKeyDown, true);
  };
}

/**
 * 声明式注册：`useEscape(() => onClose(), mounted)`。
 *
 * `active=false` 时不入栈 —— 用在"组件常驻挂载但只是被盖住"的场景
 * （比如书架被落地页盖住时，Esc 该归落地页管）。
 *
 * handler 走 ref 转发，所以不必为了稳定性去 useCallback 包它，
 * 每次渲染换新函数也不会重复加减监听。
 */
export function useEscape(handler: Handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    return pushEscape(() => ref.current());
  }, [active]);
}
