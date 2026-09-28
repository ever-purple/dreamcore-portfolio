/**
 * 手账编辑器 —— 可直接点改的正文（contenteditable 包装）
 * =============================================================================
 * 用户要求（2026-09-23）：
 *   「页面所有可编辑文字变为可直接点改（contenteditable）」
 *   「编辑范围覆盖整页：书内每一页、封面，都能改文字」
 *
 * ## 为什么不能简单地把 `contentEditable` 挂上去就完事
 * contenteditable + React 有一对经典冲突：
 *   1. **光标会跳**。只要 React 每次渲染都往这个节点写 children，浏览器就会把
 *      DOM 重建一遍 —— 光标回到开头、中文输入法候选框被打断。
 *   2. **受控值回写**。我们的文本存在 Context 里，输入 → setText → 重渲染 → 回写，
 *      这一圈如果同步走完，就正好撞上第 1 条。
 *
 * 解法（两条都要）：
 *   · **编辑态不传 children**，只给一次性 `textContent`（useLayoutEffect 里写），
 *     并且**正在聚焦时绝不写入**；
 *   · 输入走 400ms 防抖提交，提交后即便重渲染，也因"正在聚焦"而跳过写入 → 不跳光标。
 * 于是这个组件本质上是"非受控 + 受控落库"，这是 contenteditable 在 React 里唯一稳的姿势。
 *
 * ## 取值路径
 * `slot` 只是页内的槽位名（'title' / 'block2.text' …），拼上 Context 里的当前页 id
 * 才是稳定 key（见 pageId.ts 的 textKey）。所以换页不会串、往中间插板块页也不会串。
 */

import { createElement, useCallback, useContext, useLayoutEffect, useRef, type CSSProperties, type ElementType } from 'react';
import { useDiaryEditorOptional, usePageId } from '@/lib/diary-editor/context';
import { slotTextStyle } from '@/lib/diary-editor/layout';
import { sanitizeRichHtml } from '@/lib/diary-editor/storage';
import { rememberSlotEl } from '@/lib/diary-editor/inline-style';
import { isRich, plainOf } from '@/lib/diary-editor/types';
import { ElScopeCtx } from './PageEl';

type Tag = 'span' | 'p' | 'h2' | 'h3' | 'div' | 'figcaption';

type Props = {
  slot: string;
  /** 代码里的原文；用户改过就用改过的 */
  value: string;
  as?: Tag;
  className?: string;
  style?: CSSProperties;
  /** 单行字段（Enter 即结束编辑，不产生新行） */
  singleLine?: boolean;
  /** 空内容时的灰字提示 */
  placeholder?: string;
  title?: string;
};

export function EditableText({
  slot,
  value,
  as = 'span',
  className,
  style,
  singleLine,
  placeholder,
  title,
}: Props) {
  const api = useDiaryEditorOptional();
  const scoped = usePageId();
  const hostEl = useContext(ElScopeCtx);
  const ref = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = !!api?.editing;
  /* ⚠️ 用作用域里的页 id（<PageScope>），不是 api.pageId：
     翻页时底下那页（.diary-under）渲染的是**另一页**，用 api.pageId 会把当前页
     改过的文字贴到它身上 —— 翻页过程中能看到文字"跳"一下。 */
  const pid = scoped ?? api?.pageId ?? '';
  const key = api ? `${pid}:${slot}` : '';
  const raw = api ? api.getText(key, value) : value;
  const rich = isRich(raw);
  const html = rich ? raw.html : '';
  const text = rich ? plainOf(raw) : raw;
  /* 结构元素被改过字体 / 字号 / 颜色时，覆盖要打在**我这个文字槽自己身上** ——
     打在外层元素上会被槽位的 CSS 声明顶掉（见 layout.ts 的 elTextStyle 注释）。
     阅读态与编辑态都生效：这正是"保存后网站直接是编辑后的样子"。
     ⚠️ 走 slotTextStyle（元素级 → 槽级）：用户"先给整块改红、再给这行改蓝"时，
        这行是蓝的、其余行还是红的。 */
  const ovStyle = api && hostEl ? slotTextStyle(api.elOf(pid, hostEl), slot) : undefined;
  const finalStyle = ovStyle ? { ...style, ...ovStyle } : style;

  /** 把落库值写进可编辑节点：富文本写 innerHTML，纯文本写 textContent */
  const write = useCallback((el: HTMLElement) => {
    if (rich) {
      if (el.innerHTML !== html) el.innerHTML = html;
    } else if (el.textContent !== text) {
      el.textContent = text;
    }
  }, [rich, html, text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    /* 正在输入时**一个字都不要动它** —— 这就是"不跳光标"的全部秘密 */
    if (document.activeElement === el) return;
    write(el);
  }, [editing, write]);

  const commit = useCallback(() => {
    const el = ref.current;
    if (!el || !api) return;
    /* 有行内标记（用户局部改过样式）→ 存富文本；否则存纯文本（保持老数据形状）。
       标记清单与 storage 的白名单保持一致。 */
    const marked = /<(span|b|strong|i|em|u|s|font|sup|sub)\b/i.test(el.innerHTML);
    const cur = api.getText(key, value);
    if (marked) {
      const html = sanitizeRichHtml(el.innerHTML);
      if (!isRich(cur) || cur.html !== html) api.setText(key, { html });
      return;
    }
    const next = (el.textContent ?? '').replace(/\u00a0/g, ' ');
    if (isRich(cur) || next !== cur) api.setText(key, next);
  }, [api, key, value]);

  /**
   * 工具栏做**行内**改样式（改选中的那几个字的颜色）之后，会派发 `dp-commit-now`。
   * 用同步提交而不是走 400ms 防抖：用户点完色块应该立刻看到结果、也立刻落库。
   * 选区与包裹 span 由 inline-style.ts 造好，这里只负责把 innerHTML 交出去。
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    const onNow = () => commit();
    el.addEventListener('dp-commit-now', onNow);
    return () => el.removeEventListener('dp-commit-now', onNow);
  }, [editing, commit]);

  useLayoutEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!editing) {
    return createElement(
      as as ElementType,
      /* 富文本只能走 innerHTML（局部改过颜色的槽）。
         ⚠️ 内容已在 storage 的白名单里洗过（见 sanitizeRichHtml）：
            只留 span/b/i/em/u/s/font/sup/sub/br + color/font-size/font-family 这几个声明。 */
      rich
        ? { className, style: finalStyle, title, dangerouslySetInnerHTML: { __html: html } }
        : { className, style: finalStyle, title },
      rich ? undefined : text,
    );
  }

  const Tag0 = as as ElementType;
  return createElement(Tag0, {
    ref: (el: HTMLElement | null) => {
      ref.current = el;
    },
    className: className ? `${className} dp-editable` : 'dp-editable',
    style: finalStyle,
    title: title ?? '点击可以直接改字',
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    'data-dp-slot': slot,
    'data-dp-ph': placeholder ?? '',
    /* 登记"文字光标在这个槽里"——工具栏改样式时要用它决定作用域
       （光标在槽里 → 只改这个槽；没进过任何槽 → 回落到元素级）。 */
    onFocus: () => {
      if (ref.current) rememberSlotEl(ref.current);
    },
    onBlur: () => {
      if (timer.current) clearTimeout(timer.current);
      commit();
    },
    onInput: () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(commit, 400);
    },
    onPaste: (e: React.ClipboardEvent) => {
      /* 只收纯文本 —— 从网页粘进来的富文本会带一堆 inline style，把版式弄乱 */
      e.preventDefault();
      const t = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, t);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
      if (singleLine && e.key === 'Enter') {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
    },
  });
}
