/**
 * 手账编辑器 —— 底部工具栏
 * =============================================================================
 * 用户对控件分组与真实作用的原话（2026-09-23），逐条对应到实现：
 *
 * 【插入媒体】最左两个插入按钮
 *   · 插入图片  → 文件选择 → 图片作为贴纸落在当前页（可拖动/缩放/旋转/裁切）
 *   · 上传视频  → 插入带播放控件的视频贴纸（可拖动/缩放/旋转）
 *   · 素材库    → 打开素材面板（用户给的桌面素材 + 项目原有素材 + 补的贴纸）
 * 【图片框样式】图片/视频贴纸选中时切换九种外观；**未选中时改的是"默认框"**（新建图片用）
 * 【文字】添加文字 / 字体（15 项，第一项 = 现在正在用的字体）/ 文字大小（10 档）/
 *        文字框样式（八种，只作用于工具栏加的文字贴纸）/ 文字颜色（取色器）
 *        以上四项都遵守同一规则：**选中文字贴纸就改它，没选中就改默认值**
 * 【纸张】按当前页独立设置：空白纸 / 方格纸 / 纹理纸（牛皮纸）+ 纸色 + 恢复默认纸
 * 【排列】全选 / 成组 / 解组 / 上移一层 / 下移一层 / 置顶 / 置底 / 水平居中 / 垂直居中
 *        —— 2026-09-23 第二轮新增，对应用户「可以建组，整组移动」与
 *           「所有的功能与 PowerPoint 的功能一样」
 * 【页面管理】加页 / 删页（移出页序、内容保留，可恢复；结构页跳过）/ 恢复页 / 重置本页
 * 【选中与退出】复制 / 粘贴 / 删除选中 / 撤销 / 重做 / 完成
 * 另外：裁切（仅图片）、图片下方的说明文字（拍立得/卡纸/复古黄边才显示）
 *
 * ## 选中是多选的
 * 工具栏里所有"改样式"的控件都遵守同一条规则：**作用在选中的所有同类对象上**；
 * 一个都没选就改"新建默认值"。显示值取**主选中**（最后点的那个）。
 *
 * ⚠️ 页面的"翻到哪一页"由 NotebookOverlay 统一管（它才有翻页机构），
 *    所以加页/删页/恢复页以回调形式交给上层，工具栏自己不碰页序。
 * ⚠️ 「重置本页」放在【页面管理】而不是右下停靠区：它是**页级**操作，
 *    和加页/删页同一性质；停靠区留给"手滑了要能立刻撤销/退出"那几枚。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDiaryEditor } from '@/lib/diary-editor/context';
import {
  DEFAULT_PAPER,
  FRAME_STYLES,
  TEXT_BOX_STYLES,
  TEXT_SIZES,
  type DiaryLayer,
  type ElOverride,
  type ElTextStyle,
  type FrameStyle,
  type PaperKind,
  type TextAlign,
  type TextBoxStyle,
} from '@/lib/diary-editor/types';
import { EDITOR_FONTS, ensureFont, familyOf, fontIdFromFamily, labelOf } from '@/lib/diary-editor/fonts';
import { staggerSpot, toHex } from '@/lib/diary-editor/layout';
import {
  applyInlineStyle,
  captureSelection,
  hasInlineSelection,
  slotInfo,
} from '@/lib/diary-editor/inline-style';
import { ColorRow, FrameGrid, Popover, TbAlignRow, TbButton, TbGroup, TbSelect, TbSep, TextBoxGrid } from './bits';
import { StickerPicker } from './StickerPicker';

const PAPER_KINDS: { id: PaperKind; label: string }[] = [
  { id: 'blank', label: '空白纸' },
  { id: 'grid', label: '方格纸' },
  { id: 'kraft', label: '纹理纸（牛皮纸）' },
];

/** 纸张默认色（与 index.css 里 .dp-paper.is-* 保持一致，取色器初始值用） */
const PAPER_DEFAULT_COLOR: Record<PaperKind, string> = {
  blank: '#fbf8ef',
  grid: '#f7f3e6',
  kraft: '#ece7d4',
};

export function DiaryToolbar({
  pageId,
  pageLabel,
  cropping,
  setCropping,
  onAddPage,
  onDeletePage,
  onRestorePage,
  onDone,
}: {
  pageId: string;
  pageLabel: string;
  cropping: boolean;
  setCropping: (v: boolean) => void;
  onAddPage: () => void;
  onDeletePage: () => void;
  onRestorePage: (id: string) => void;
  onDone: () => void;
}) {
  const e = useDiaryEditor();
  const [picker, setPicker] = useState(false);
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);

  const layers = e.layersOf(pageId);
  /** 选中的全部图层（多选时按顺序） */
  const selLayers = e.selection
    .filter((r) => r.kind === 'layer')
    .map((r) => layers.find((l) => l.id === r.id))
    .filter(Boolean) as DiaryLayer[];
  /** 选中的结构元素 id（页面自带的标题 / 正文 / 手绘边框 / 照片 / 纸胶带…） */
  const selEls = e.selection.filter((r) => r.kind === 'el').map((r) => r.id);
  /** 主选中图层（最后点的那一个）—— 控件显示值用它 */
  const sel = e.selected;
  const isText = sel?.type === 'text';
  const isMedia = sel?.type === 'image' || sel?.type === 'video';
  const isImage = sel?.type === 'image';
  const nSel = e.selection.length;
  const nEl = selEls.length;

  /* ---------------- 「改样式会改到哪里」—— 三层作用域 ----------------
     用户 2026-09-23：「选中的文字变色不了，变的是没选中的文字」。
     拖选了 4 个字点红色，结果是整块思维导图（22 个槽）变红。作用域宽了一整圈。
     修复后按**窄 → 宽**依次尝试（见 lib/diary-editor/inline-style.ts）：
       ① 行内：选区里真有字符 → 只给这几个字套 <span style>；
       ② 槽级：光标停在这一段里 → 只改这一段（`ElOverride.texts[slot]`）；
       ③ 元素级：用户把作用范围切到「整个元素」→ 改它里面的每个文字槽
                   （`ElOverride.text`，老行为）。
     `textPatch` 记住"刚刚改成了什么"，让控件立刻显示新值 —— 否则用户点完红色、
     色块还停在旧色上，会以为"又没生效"。 */
  const [textPatch, setTextPatch] = useState<Partial<ElTextStyle>>({});
  /**
   * 光标当前在哪个文字槽里（`元素id:槽名`，没在文字里就是 null）。
   *
   * ⚠️ 必须用 state 而不是渲染时现算：`onFocus` 登记发生在 pointerup、
   *    而选中态更新发生在 pointerdown —— 渲染时现算会读到"还没进槽"的旧值，
   *    于是「作用范围」这一个控件时有时无。挂个监听强制同步一次最稳。
   */
  const [slotKey, setSlotKey] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const si = slotInfo();
      const k = si?.elId ? `${si.elId}:${si.slot}` : null;
      /* React 对相同值会自动跳过重渲染，所以高频的 selectionchange 不会变成性能问题 */
      setSlotKey((p) => (p === k ? p : k));
    };
    sync();
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', sync);
    return () => {
      document.removeEventListener('focusin', sync);
      document.removeEventListener('focusout', sync);
    };
  }, []);
  /** 改字体/字号/颜色时作用到哪一级（有光标在文字里时才让用户选）。
      ⚠️ 默认「整个元素」：用户 2026-09-23「修改文字是一块一块的，很不方便」——
      单击选中结构元素时 `focusTextAt` 会把焦点自动落到点击处的那个槽，
      若默认「本段」改样式就只打回那一个槽（"只变第一个字/只变这一行"），
      用户的心智是"选中了整块就该改整块"。所以默认整块，想只改光标那一段再切「本段」。 */
  const [elScope, setElScope] = useState<'slot' | 'el'>('el');
  useEffect(() => {
    /* 换了选中对象 / 翻页 / 挪到别的槽 → 丢掉"上一次改的值" */
    setTextPatch({});
  }, [e.selection, e.selEl, pageId, slotKey]);

  /**
   * 抓选区快照 —— 「选中的文字变色不了」修复的必要条件。
   *
   * 用户的操作是"拖选 4 个字 → 点色块"，而点色块会让 contenteditable **先失焦**、
   * 浏览器随即丢掉原生选区；等 onClick 跑起来再读 `window.getSelection()`
   * 已经什么都读不到，只能回落到"改整块"（这就是老 bug 的现场）。
   * mousedown 的 capture 阶段早于浏览器的默认行为（清选区），此刻快照一份存着。
   *
   * ⚠️ 挂在 **document** 上而不是工具栏根节点：色板/字体这些弹层是
   *    `createPortal` 到 body 的（为了不被 `overflow-x:auto` 裁掉，见 bits.tsx），
   *    DOM 上**不是**工具栏的后代，挂在根节点上根本收不到色块的 mousedown。
   */
  useEffect(() => {
    const onDown = () => captureSelection();
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, []);

  /* ---------------- 选中对象的**真实**样式回显 ----------------
     用户 2026-09-23：「选中文字或素材边框样式，文字的字体字号颜色样式也会在下方
     这里显示出来」。两类对象取值方式不同：
       1. **图层**（自己贴的贴纸）→ 属性就在 doc 里，读出来就是真值；
       2. **结构元素**（页面自带的标题/正文）→ doc 里没有样式属性，只能"实测"：
          · 用户改过 → `els[id].text` 有覆盖，**覆盖优先**（顺带绕开了"实测值要等
            下一帧才刷新"的时序问题：改完立刻显示，不用等重渲染）；
          · 没改过 → 读 DiaryCanvas 量出来的 computed font-family / 字号 / 颜色。 */
  const elInfoAll = e.bridge.current?.elStyles;
  const selEl = e.selEl;
  const selElInfo = selEl ? elInfoAll?.[selEl] : undefined;
  const selElText = selEl ? e.elOf(pageId, selEl)?.text : undefined;
  /* ⚠️ 槽级覆盖也要进回显（用户 2026-09-24：「选中的字体不是下面显示的那个字体」）：
     早期版本把字体/字号写进过 `texts[槽]`（只改光标那一段），而这里只读元素级
     `text` —— 结果那段字明明渲染成了别的字体，下拉还显示原来的。
     光标停在选中元素的某个槽里时，槽级覆盖最贴近"现在看到的字"，优先级最高。 */
  const echoSlot = (() => {
    if (!selEl) return undefined;
    const si = slotInfo();
    return si?.elId === selEl && si.slot ? e.elOf(pageId, selEl)?.texts?.[si.slot] : undefined;
  })();
  /** 主选中的结构元素里"有没有文字"—— 没有（手绘边框/照片/胶带）就不显示字体三项 */
  const elHasText = !!selElInfo?.hasText;
  const elFontId = selEl
    ? (echoSlot?.font ??
      selElText?.font ??
      (selElInfo?.fontFamily ? fontIdFromFamily(selElInfo.fontFamily) : null))
    : null;
  const elSize = selEl
    ? (echoSlot?.size ?? selElText?.size ?? (elHasText ? selElInfo!.fontSize : undefined))
    : undefined;
  const elColor = selEl
    ? (echoSlot?.color ??
      selElText?.color ??
      (elHasText && selElInfo!.color ? toHex(selElInfo!.color) : undefined))
    : undefined;
  /** 字体 / 字号 / 颜色这三项对当前选中对象适用吗 */
  const textApplies = isText || elHasText;

  /* 目标值：选中了就取主选中的**真实值**，否则取"新建默认值"（并显示在控件上）。
     ⚠️ `textPatch` 优先级最高：它代表"用户刚刚改成了什么"。
        行内改色（只改了选中的几个字）在 doc 里没有对应的元素级字段，
        不看它就永远显示旧色 —— 看起来像"点了没反应"。 */
  /* 结构元素上的框样式覆盖（用户 2026-09-23：「放边框没反应」） */
  const elDeco = selEl ? e.elOf(pageId, selEl) : undefined;
  /**
   * 「图片框样式 / 文字框样式」对当前选中对象适用吗。
   *
   * ⚠️ 以前是 `isMedia` / `isText`（只认用户贴的图层）。选中页面自带的照片 /
   *    手绘边框 / 正文块时按钮显示破折号 —— 而用户点下去也不会报错、什么都不发生，
   *    这就是「放边框没反应」的现场。现在结构元素也吃这两项。
   */
  const frameApplies = isMedia || !!selEl;
  const boxApplies = isText || !!selEl;
  const curFrame: FrameStyle = isMedia ? sel.frame : (elDeco?.frame ?? e.defaults.frame);
  const curFont = isText
    ? (textPatch.font ?? sel.font)
    : (textPatch.font ?? elFontId ?? (textApplies ? '' : e.defaults.font));
  const curSize = isText ? (textPatch.size ?? sel.size) : (textPatch.size ?? elSize ?? e.defaults.size);
  const curBox: TextBoxStyle = isText ? sel.box : (elDeco?.tbox ?? e.defaults.box);
  const curColor = isText
    ? (textPatch.color ?? sel.color)
    : (textPatch.color ?? elColor ?? e.defaults.color);
  /**
   * 当前对齐值。三种来源，优先级与字体/字号一致：
   *   ① 刚改过（`textPatch`）→ 立刻回显；
   *   ② 文字贴纸 → 图层自己的字段；结构元素 → `els[id].text.align` 覆盖，
   *      没改过就读 DiaryCanvas 实测的 computed `text-align`；
   *   ③ 都没有 → 左对齐。
   */
  const curAlign: TextAlign =
    textPatch.align ??
    (isText
      ? (sel.align ?? 'left')
      : ((selEl ? e.elOf(pageId, selEl)?.text?.align : undefined) ??
        (selElInfo?.textAlign as TextAlign | undefined) ??
        'left'));

  /** 字号下拉的档位 = 10 档 + 「当前实际值」。
      结构文字的字号常常不在档里（17px / 22px…），不插进去下拉会显示成空白。
      ⚠️ 必须插**原值**、不能插取整值（用户 2026-09-24：「标题显示12px，明显不对」）：
      页面标题实测 25.6px（1.6rem×16），旧代码插的是 Math.round(25.6)=26 这一档，
      而受控 select 的 value="25.6" 匹配不到任何 <option> —— 浏览器按 HTML 规范
      把选中项回退到**第一档 12px**，于是状态条明明写着 25.6px、下拉却显示 12px。
      凡是带小数的实测字号（25.6 / 16.5 / 13.5 / 12.5）全部中招，整数才正常。 */
  const sizeOptions = useMemo(() => {
    const set = new Set<number>(TEXT_SIZES);
    if (Number.isFinite(curSize) && curSize > 0 && !set.has(curSize)) set.add(curSize);
    return [...set].sort((a, b) => a - b);
  }, [curSize]);

  /**
   * 改样式：**作用在所有选中的同类对象上**（多选时一次改一批）；
   * 一个都没选就改"新建默认值"。
   *
   * ⚠️ 结构元素（页面自带的标题/正文）走**另一条落库路径**：不是图层属性，
   *    而是 `els[id].text` 覆盖（见 context 的 updateElText）。
   *    框样式（frame / box）对结构元素不适用 —— 版式文字没有贴纸底。
   */
  const patchStyle = (patch: {
    frame?: FrameStyle;
    font?: string;
    size?: number;
    box?: TextBoxStyle;
    color?: string;
    align?: TextAlign;
  }) => {
    const kinds: { key: keyof typeof patch; type?: DiaryLayer['type'][] }[] = [
      { key: 'frame', type: ['image', 'video'] },
      { key: 'font', type: ['text'] },
      { key: 'size', type: ['text'] },
      { key: 'box', type: ['text'] },
      { key: 'color', type: ['text'] },
      { key: 'align', type: ['text'] },
    ];
    let touched = 0;
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      const rule = kinds.find((x) => x.key === k);
      if (!rule) continue;
      const targets = selLayers.filter((l) => !rule.type || rule.type.includes(l.type));
      for (const l of targets) {
        e.updateLayer(pageId, l.id, { [k]: patch[k] } as never);
        touched++;
      }
    }

    /* 结构元素上的**框样式**：走 `updateEl`（元素级覆盖），落成
       `data-dp-frame` / `data-dp-tbox` 属性（见 PageEl 的 PageElAttrs 注释）。
       用户 2026-09-23：「放边框没反应」—— 以前 `frame` 只认 image/video 图层、
       `box` 只认 text 图层，选中页面自带的照片 / 手绘边框 / 正文块时
       **一个落点都没有**，最后静默掉进 `setDefaults()`：改的是"新建默认值"，
       眼前什么都不变，用户看到的就是"点了没反应"。 */
    const elDeco: Partial<ElOverride> = {};
    if (patch.frame !== undefined) elDeco.frame = patch.frame;
    if (patch.box !== undefined) elDeco.tbox = patch.box;
    if (Object.keys(elDeco).length) {
      /* 文字焦点的**借用**只发生在"什么都没选中"时 —— 选中了别的对象（比如一张
         文字贴纸）还把框打到旧焦点元素上，就是"点了没反应/改错对象"的又一现场。
         （文字贴纸的 box 早在上面图层分支里 updateLayer 落掉了，到不了这里。） */
      const si0 = nSel ? null : slotInfo();
      const ids = selEls.length ? selEls : si0?.elId ? [si0.elId] : [];
      for (const id of ids) {
        e.updateEl(pageId, id, elDeco);
        touched++;
      }
    }

    /* 结构元素的**文字样式**：只有字体 / 字号 / 颜色 / 对齐四项（框样式走上面那条）。
       ⚠️ 作用域**由窄到宽**依次尝试 —— 这是「选中的文字变色不了，变的是没选中的
          文字」那条反馈的修复核心。顺序反了就会退回"一改整块"的老毛病。 */
    const elPatch: Partial<ElTextStyle> = {};
    if (patch.font !== undefined) elPatch.font = patch.font;
    if (patch.size !== undefined) elPatch.size = patch.size;
    if (patch.color !== undefined) elPatch.color = patch.color;
    if (patch.align !== undefined) elPatch.align = patch.align;
    /* ⚠️ 对齐**只能**元素级：`text-align` 对 `display:inline` 的文字槽没有作用
       （思维导图的 `mm.*` 都是 `<span>`），行内 `<span style>` 同样没用。
       所以只要这次改的是"对齐"，就直接跳到元素级。 */
    const alignOnly =
      elPatch.align !== undefined &&
      elPatch.font === undefined &&
      elPatch.size === undefined &&
      elPatch.color === undefined;
    if (Object.keys(elPatch).length) {
      const si = slotInfo();
      /**
       * 行内 / 槽级这两个**窄作用域**什么时候才允许生效？
       * 仅当「恰好选中一个结构元素，且它就是文字焦点所在的元素」。
       *
       * 用户 2026-09-23 晚：「调整字号的时候，全选只变第一个字，或者变的是行间距」。
       * 根因：文字焦点（slotEl）是**登记制**的——用户双击改过某段字、或者点过某个槽，
       * 焦点一直留着；之后他用工具栏「全选」选中整页对象再改字号，旧焦点还在，
       * ③ 槽级就把字号只打回了**第一个槽**（"只变第一个字/只有那段的行距变了"），
       * 其余全部没动。多选/全选时用户的心智是"改我选中的这一批"，必须走元素级。
       */
      const singleEl = selEls.length === 1 && si?.elId === selEls[0];
      /** 元素级：把选中的结构元素里**每一个**文字槽都改掉（没有文字的跳过） */
      const applyElLevel = (): boolean => {
        let any = false;
        for (const id of selEls) {
          if (!elInfoAll?.[id]?.hasText) continue;
          e.updateElText(pageId, id, elPatch);
          any = true;
        }
        /* 什么都没选中、但光标停在某段文字里 → 至少改掉那一段所在的元素，
           否则"点了居中没反应"。选中集非空时不借用（那会改错对象）。 */
        if (!any && !nSel && si?.elId) {
          e.updateElText(pageId, si.elId, elPatch);
          any = true;
        }
        return any;
      };

      let done = false;
      if (alignOnly) {
        done = applyElLevel();
      } else {
        /* ① 行内：选区里真的选中了字符 → 只改这几个字（造 <span style> 并立刻落库） */
        if (singleEl && hasInlineSelection()) done = applyInlineStyle(elPatch);
        /* ② 元素级：用户把「作用范围」切到了整块 */
        if (!done && (elScope === 'el' || !singleEl)) done = applyElLevel();
        /* ③ 槽级：光标停在这一段里 → 只改这一段（singleEl 已保证焦点元素就是选中元素） */
        if (!done && singleEl && si?.elId && si.slot) {
          e.updateElSlotText(pageId, si.elId, si.slot, elPatch);
          done = true;
        }
        /* ④ 兜底：选中了结构元素、但光标不在任何文字槽里（刚选中还没点进去） */
        if (!done) done = applyElLevel();
      }

      if (done) {
        touched++;
        setTextPatch((p) => ({ ...p, ...elPatch }));
      }
    }

    if (touched) {
      if (patch.font) void ensureFont(patch.font);
      return;
    }
    /* 一个能改的对象都没选中 → 这次改的是"新建默认值"。页面不会有任何变化，
       必须说出来 —— 用户 2026-09-23：「点了没反应」的另一半现场就在这
       （先点了空白处取消了选中，再点样式按钮）。 */
    e.setDefaults(patch);
    if (patch.font) void ensureFont(patch.font);
    e.say('先点一下要改的文字或贴纸再改样式 —— 这次先记成了「新建默认值」');
  };

  const addText = () => {
    const spot = staggerSpot(layers);
    const layer: DiaryLayer = {
      id: `t-${Date.now().toString(36)}`,
      type: 'text',
      text: '在这里写字',
      font: e.defaults.font,
      size: e.defaults.size,
      color: e.defaults.color,
      box: e.defaults.box,
      align: e.defaults.align,
      cx: spot.cx,
      cy: spot.cy,
      w: 0.3,
      rot: 0,
      z: layers.reduce((m, l) => Math.max(m, l.z), 0) + 1,
    };
    void ensureFont(layer.font);
    e.addLayer(pageId, layer);
    e.setSel(layer.id);
  };

  const paper = e.paperOf(pageId) ?? DEFAULT_PAPER;
  const paperColor = paper.color ?? PAPER_DEFAULT_COLOR[paper.kind];
  const paperLabel = PAPER_KINDS.find((k) => k.id === paper.kind)?.label ?? '空白纸';

  const saveText =
    e.saveState === 'saving'
      ? '保存中…'
      : e.saveState === 'dirty'
        ? '有改动待保存'
        : e.saveState === 'saved'
          ? '已保存到本机'
          : e.saveState && typeof e.saveState === 'object'
            ? e.saveState.error
            : e.ready
              ? '自动保存已开启'
              : '正在读取…';

  /** 选中的是什么（状态条上那枚小胶囊） */
  const selText = nSel
    ? `选中 ${nSel} 个${nEl ? `（含 ${nEl} 个页面元素）` : ''}`
    : '未选中';

  /* ---------------- 层序位置回显 ----------------
     用户 2026-09-23 录屏投诉：「编辑的时候还是看不到是不是在底层或顶层」。
     这里算出选中块在层序里的位置，既在状态条显示"第几层 / 顶层 / 底层 /
     已沉到页面内容下面"，也用来把排列按钮在"已到极值"时置灰。 */
  const zRank = e.zRankOf(pageId, e.selection);
  /** 层位徽章文案：顶层 / 底层 / 第 X/Y 层（under 那档叫"页面内容下面"） */
  const zRankLabel = zRank
    ? zRank.under
      ? `页面内容下面`
      : zRank.isTop && zRank.isBottom
        ? `第 1/1 层`
        : zRank.isTop
          ? '顶层'
          : zRank.isBottom
            ? '底层'
            : `第 ${zRank.position}/${zRank.total} 层`
    : null;

  /* ---------------- 显示用的短标签（按钮上那行小字） ---------------- */

  const frameLabel = FRAME_STYLES.find((f) => f.id === curFrame)?.label ?? String(curFrame);
  const boxLabel = TEXT_BOX_STYLES.find((b) => b.id === curBox)?.label ?? String(curBox);
  /** 结构元素（手绘边框 / 照片 / 胶带…）没有"贴纸框"这个概念，显示一个破折号 */
  const NA = '—';

  /** 字体短名：下拉里是「中文手写 · 胡涂体（本站在用）」这种全名，状态条放不下 */
  const shortFont = (id: string) =>
    id ? (labelOf(id).split('·').pop() ?? labelOf(id)).replace(/（.*?）/, '').trim() : '页面自定义';

  /**
   * 状态条上的「当前样式」摘要 —— 用户要的"在下方显示出来"。
   * 只报**适用于当前对象**的那几项，避免出现"底色：无框"这种对照片毫无意义的字。
   */
  const styleBits: string[] = [];
  if (isMedia) styleBits.push(frameLabel);
  if (isText) {
    styleBits.push(shortFont(curFont), `${curSize}px`, boxLabel, curColor);
  }
  if (selEl) {
    /* 结构元素上的框样式（用户 2026-09-23：「放边框没反应」之后加的） */
    if (elDeco?.frame) styleBits.push(frameLabel);
    if (elDeco?.tbox) styleBits.push(boxLabel);
    if (elHasText) {
      styleBits.push(shortFont(curFont), `${curSize}px`);
      if (elColor) styleBits.push(elColor);
    } else {
      styleBits.push('可拖动 / 缩放 / 旋转');
    }
  }

  return (
    <>
      <div className="dp-toolbar" role="toolbar" aria-label="手账编辑器">
        <div className="dp-toolbar-main">
        <div className="dp-toolbar-scroll">
          {/* ---------- 插入媒体 ---------- */}
          <TbGroup title="插入媒体">
            <TbButton label="插入图片" title="选择图片文件，作为可拖动/缩放/旋转/裁切的贴纸插入" onClick={() => imgInput.current?.click()} />
            <TbButton label="上传视频" title="插入一个带播放控件的视频贴纸" onClick={() => vidInput.current?.click()} />
            <TbButton label="素材库" title="打开素材库（含你给的素材与已补的贴纸）" onClick={() => setPicker(true)} />
            <input
              ref={imgInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) void e.addImageFile(pageId, f);
                ev.target.value = '';
              }}
            />
            <input
              ref={vidInput}
              type="file"
              accept="video/*"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                if (f) void e.addVideoFile(pageId, f);
                ev.target.value = '';
              }}
            />
          </TbGroup>

          <TbSep />

          {/* ---------- 图片框样式 ---------- */}
          <TbGroup title="图片框样式">
            <Popover
              label="图片框样式"
              title="外观：无边框 / 拍立得 / 纸胶带 / 手帐卡纸 / 圆形裁切 / 复古黄边 / 虚线边框 / 双线相框 / 立体悬浮 / 四格相框（蓝色，双击某一格换那格的图；对页面自带的照片、手绘边框、正文块同样有效）"
              wide
              active={frameApplies}
              value={frameApplies ? frameLabel : nSel ? NA : undefined}
            >
              {() => (
                <FrameGrid
                  value={curFrame}
                  /* 「四格相框」只对图片有意义（四个窗口放四张图）——
                     选中视频时不给它选，免得套上后渲染成蓝底单窗 */
                  exclude={isMedia && !isImage ? ['quad'] : undefined}
                  onPick={(v) => {
                    patchStyle({ frame: v });
                    /* 一个"能套框"的对象都没选中 → 这次改的是**新建默认值**。
                       必须说出来，否则用户会以为"点了没反应"。 */
                    if (!selLayers.length && !selEls.length) e.say(`已设为新建图片的默认框：${v}`);
                  }}
                />
              )}
            </Popover>
            <TbButton
              label="裁切"
              title="裁切选中的图片（拖动四条边）"
              active={cropping}
              disabled={!isImage}
              onClick={() => setCropping(!cropping)}
            />
          </TbGroup>

          <TbSep />

          {/* ---------- 文字 ---------- */}
          <TbGroup title="文字">
            <TbButton label="添加文字" title="在当前页插入一个可编辑文字贴纸" onClick={addText} />
            {/* 对齐 —— 用户 2026-09-23：「把文字块做成ppt那种框，可以调整对齐」。
                ⚠️ 位置是刻意的：放在「文字」组的**最前**（紧跟添加文字）。
                   工具栏中段是横向可滚的（实测 1440 宽下可视区只到 x≈1040，
                   而「文字」组一直排到 1284），放在组尾会**整块被裁在视野外**，
                   新功能藏起来等于没做。放最前才能一眼看到。
                ⚠️ 作用域**只有元素级**（`text-align` 对 inline 文字槽无效，
                   思维导图的槽全是 `<span>`）—— 见 patchStyle 的 alignOnly 分支。 */}
            <TbAlignRow value={curAlign} onChange={(v) => patchStyle({ align: v })} />
            <TbSelect
              label="字体"
              title="选中文字贴纸 / 页面自带文字就改它；没选中就改新建文字的默认字体"
              value={curFont}
              previewFont={curFont ? familyOf(curFont) : undefined}
              onChange={(v) => patchStyle({ font: v })}
            >
              {/* 分组显示（用户 2026-09-23：「很多字体……用不了」——根因是拉丁字体
                  没有汉字字形，选了以后中文原样不动。分组 + 标注"英文·数字"把
                  预期讲清楚；拉丁字体的汉字已统一兜底到胡涂体，见 fonts.ts）。 */}
              {curFont === '' ? (
                <option value="">
                  页面自定义{selElInfo?.fontFamily ? `（${selElInfo.fontFamily.split(',')[0].replace(/['"]/g, '')}）` : ''}
                </option>
              ) : null}
              <optgroup label="本站在用">
                {EDITOR_FONTS.filter((f) => ['default', 'pflutu', 'nano'].includes(f.id)).map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="中文手写 · 毛笔 / 行书 / 宋体">
                {EDITOR_FONTS.filter((f) => f.cjk && !['pflutu', 'nano'].includes(f.id)).map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="英文 · 数字（汉字跟胡涂体）">
                {EDITOR_FONTS.filter((f) => f.cjkFallback).map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            </TbSelect>
            <TbSelect
              label="文字大小"
              title="字号（px）。页面自带的文字显示的是它的实际字号"
              value={String(curSize)}
              onChange={(v) => patchStyle({ size: Number(v) })}
            >
              {sizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}px{TEXT_SIZES.includes(s as never) ? '' : '（当前）'}
                </option>
              ))}
            </TbSelect>
            {/* 改字体/字号/颜色的**作用范围** —— 只在"光标停在某段文字里、
                同时又选中了它所属的结构元素"时才出现（这时候才有歧义）。
                默认「整个元素」= 选中整块就改整块（用户 2026-09-23「一块一块改不方便」）；
                想只改光标所在那一段，再切到「本段」。 */}
            {slotKey && nEl > 0 ? (
              <TbSelect
                label="作用范围"
                title="改字体/字号/颜色时改到哪一级：「整个元素」把选中元素内部每一段文字都改掉；「本段」只改光标所在的这一段"
                value={elScope}
                onChange={(v) => setElScope(v === 'el' ? 'el' : 'slot')}
              >
                <option value="el">整个元素</option>
                <option value="slot">本段</option>
              </TbSelect>
            ) : null}
            <Popover
              label="文字框样式"
              title="八种文字框外观（自己加的文字贴纸，和页面自带的正文块都能套）"
              wide
              active={boxApplies}
              value={boxApplies ? boxLabel : nSel ? NA : undefined}
            >
              {() => (
                <TextBoxGrid
                  value={curBox}
                  onPick={(v) => {
                    patchStyle({ box: v });
                    if (!selLayers.length && !selEls.length) e.say(`已设为新建文字的默认框：${v}`);
                  }}
                />
              )}
            </Popover>
            <Popover
              label="文字颜色"
              title={textApplies ? `当前：${curColor}` : '取色器（作用于选中的文字贴纸 / 页面自带文字）'}
              value={
                textApplies ? (
                  <span className="dp-btn-sw" style={{ background: curColor }} aria-label={curColor} />
                ) : nSel ? (
                  NA
                ) : undefined
              }
            >
              {() => <ColorRow value={curColor} onChange={(c) => patchStyle({ color: c })} />}
            </Popover>
          </TbGroup>

          <TbSep />

          {/* ---------- 排列（第二轮新增，对齐 PowerPoint 的"排列"） ---------- */}
          <TbGroup title="排列">
            <TbButton label="全选" title="选中本页所有对象（Ctrl+A）" onClick={e.selectAllOnPage} />
            <TbButton
              label="成组"
              title="把选中的多个对象绑成一组，之后点其中任意一个就整组动（Ctrl+G）"
              disabled={nSel < 2}
              onClick={e.groupSelection}
            />
            <TbButton
              label="解组"
              title="把选中对象所在的组合拆开（Ctrl+Shift+G）"
              disabled={!nSel}
              onClick={e.ungroupSelection}
            />
            <TbButton
              label="上移一层"
              title={
                zRank?.isTop
                  ? '已经在最顶层了'
                  : '在层序里往上一层（Ctrl+]）；按住 Ctrl+Shift+] 直接到顶'
              }
              disabled={!nSel || !!zRank?.isTop}
              onClick={() => e.orderRefs(pageId, e.selection, 'up')}
            />
            <TbButton
              label="下移一层"
              title={
                zRank?.under
                  ? '已经在页面内容下面（最底）'
                  : '在层序里往下一层（Ctrl+[）；已经在普通层最底时再按会沉到页面内容下面'
              }
              disabled={!nSel || !!zRank?.under}
              onClick={() => e.orderRefs(pageId, e.selection, 'down')}
            />
            <TbButton
              label="置顶"
              title={zRank?.isTop ? '已经在最顶层了' : '压在所有同页对象之上（Ctrl+Shift+]）'}
              disabled={!nSel || !!zRank?.isTop}
              onClick={() => e.orderRefs(pageId, e.selection, 'front')}
            />
            <TbButton
              label="置底"
              title={
                zRank?.under
                  ? '已经在页面内容下面（最底）'
                  : '压在所有同页对象之下（Ctrl+Shift+[）；已经在普通层最底时再按会沉到页面内容下面'
              }
              disabled={!nSel || !!zRank?.under}
              onClick={() => e.orderRefs(pageId, e.selection, 'back')}
            />
            <TbButton
              label="水平居中"
              title="把选中对象的中心对到纸面中轴（Ctrl+E）"
              disabled={!nSel}
              onClick={() => e.alignRefs(pageId, e.selection, 'hcenter')}
            />
            <TbButton
              label="垂直居中"
              title="把选中对象的中心对到纸面中线（Ctrl+Shift+E）"
              disabled={!nSel}
              onClick={() => e.alignRefs(pageId, e.selection, 'vcenter')}
            />
          </TbGroup>

          <TbSep />

          {/* ---------- 纸张 ---------- */}
          <TbGroup title="纸张">
            <Popover label="纸张" title="按当前页独立设置纸张材质与颜色" wide value={paperLabel}>
              {() => (
                <div className="dp-paper-panel">
                  <p className="dp-pop-hint">当前页纸张 · {pageLabel}</p>
                  <div className="dp-paper-kinds">
                    {PAPER_KINDS.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        className={`dp-cell${paper.kind === k.id ? ' is-on' : ''}`}
                        onClick={() => e.setPaper(pageId, { kind: k.id, color: paper.color })}
                      >
                        <span className={`dp-paper-demo is-${k.id}`} />
                        <span className="dp-cell-label">{k.label}</span>
                      </button>
                    ))}
                  </div>
                  <ColorRow
                    label="纸张颜色"
                    value={paperColor}
                    onChange={(c) => e.setPaper(pageId, { kind: paper.kind, color: c })}
                  />
                  <button
                    type="button"
                    className="dp-btn is-wide"
                    onClick={() => {
                      e.setPaper(pageId, undefined);
                      e.say('已恢复默认纸');
                    }}
                  >
                    恢复默认纸
                  </button>
                  <p className="dp-pop-note">每一页的纸张各自独立保存，翻到哪页改哪页。</p>
                </div>
              )}
            </Popover>
          </TbGroup>

          <TbSep />

          {/* ---------- 页面管理 ---------- */}
          <TbGroup title="页面管理">
            <TbButton label="加页" title="在当前页后面插入一张空白页" onClick={onAddPage} />
            <TbButton
              label="删页"
              title="把当前页移出页序（内容保留，可随时恢复；封面会自动跳过）"
              onClick={() => {
                /* 用户口径：「删页」删除当前页并**二次确认**。
                   内容其实不销毁（进「恢复页」随时放回），但仍然问一次防手滑。 */
                if (
                  window.confirm(
                    '把当前这一页从页序里拿掉？这一页的内容会保留，随时可以从「恢复页」放回来。封面等结构页会自动跳过。',
                  )
                ) {
                  onDeletePage();
                }
              }}
            />
            {e.removed.length ? (
              <Popover label={`恢复页（${e.removed.length}）`} title="把移出页序的页面放回来" wide>
                {(close) => (
                  <div className="dp-restore">
                    <p className="dp-pop-hint">这些页被移出了，内容都还在：</p>
                    {e.removed.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="dp-btn is-wide"
                        onClick={() => {
                          onRestorePage(id);
                          close();
                        }}
                      >
                        ＋ 放回这一页
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
            ) : null}
            <TbButton
              label="重置本页"
              title="清空这一页的全部改动，恢复默认"
              onClick={() => {
                if (
                  window.confirm(
                    '把这一页恢复成最初的样子？这一页添加的贴纸、改过的字、挪过的元素位置都会清掉。',
                  )
                ) {
                  e.resetPage(pageId);
                }
              }}
            />
          </TbGroup>

          <TbSep />

          {/* ---------- 说明文字（选中媒体且框型带说明位时） ---------- */}
          {isMedia && sel && (sel.frame === 'polaroid' || sel.frame === 'card' || sel.frame === 'retro') ? (
            <>
              <TbSep />
              <TbGroup title="图片说明">
                <label className="dp-input">
                  <span className="dp-select-label">说明文字</span>
                  <input
                    type="text"
                    value={sel.caption ?? ''}
                    placeholder="写在这张照片下面"
                    onChange={(ev) => e.updateLayer(pageId, sel.id, { caption: ev.target.value } as never, `cap:${sel.id}`)}
                  />
                </label>
              </TbGroup>
            </>
          ) : null}
        </div>

        {/* ---------- 右停靠：选中操作与退出 ----------
            ⚠️ 必须在 .dp-toolbar-scroll **外面**。实测 1440 视口下前面的分组内容
            远超视口宽，「撤销 / 重做 / 完成」会被推到视口外、点不到。
            这三枚是「手滑了要能撤销、要能退出」的兜底操作，绝不能藏在滚动区里，
            所以单独停靠在右侧、不参与横向滚动。 */}
        <div className="dp-toolbar-dock">
          <TbGroup title="选中操作">
            <TbButton
              label="复制"
              title="复制选中的对象（Ctrl+C）；复制页面元素会抓成一份文字贴纸"
              disabled={!nSel}
              onClick={() => {
                if (!e.copySelection()) e.say('先点一下要复制的对象');
              }}
            />
            <TbButton label="粘贴" title="粘贴（Ctrl+V）" onClick={() => e.pasteClipboard(pageId) || e.say('剪贴板里还没有内容')} />
            <TbButton
              label="删除选中"
              title="删掉选中的贴纸 / 文字；选中页面元素时 = 把它放回原位"
              tone="danger"
              disabled={!nSel}
              onClick={e.deleteSelection}
            />
            <TbButton label="撤销" title="撤销上一步（Ctrl+Z）" disabled={!e.canUndo} onClick={e.undo} />
            <TbButton label="重做" title="重做（Ctrl+Y / Ctrl+Shift+Z）" disabled={!e.canRedo} onClick={e.redo} />
            <TbButton label="完成" title="退出编辑（内容已经自动保存）" tone="primary" onClick={onDone} />
          </TbGroup>
        </div>
      </div>

        <div className="dp-status">
          <span className="dp-page-chip">{pageLabel}</span>
          <span className={`dp-sel-chip${nSel ? ' is-on' : ''}`}>{selText}</span>
          {zRankLabel ? (
            <span
              className={`dp-zrank-chip${zRank?.under ? ' is-under' : zRank?.isTop ? ' is-top' : zRank?.isBottom ? ' is-bottom' : ''}`}
              title={`当前在层序里的位置：${zRankLabel}（共 ${zRank?.total} 层，最上是第 ${zRank?.total} 层）`}
            >
              {zRankLabel}
            </span>
          ) : null}
          {styleBits.length ? (
            <span
              className={`dp-style-chip${selEl ? ' is-el' : ''}`}
              title="选中对象**真实**的样式（改过的按改过的显示，没改过的按页面原本的显示）"
            >
              {styleBits.join(' · ')}
            </span>
          ) : null}
          {cropping ? <span className="dp-crop-badge">裁切中</span> : null}
          <span className={`dp-save${e.saveState && typeof e.saveState === 'object' ? ' is-error' : ''}`}>{saveText}</span>
          <span className="dp-hintline">
            点 = 选中可拖 · 双击 = 改字 · 右键 = 剪切/复制/粘贴/成组 · Shift 加选 / 空白拖框选 ·
            Ctrl+Z/Y 撤销重做
          </span>
        </div>
      </div>

      {e.hint ? <div className="dp-toast">{e.hint}</div> : null}
      {picker ? (
        <StickerPicker
          onClose={() => setPicker(false)}
          onPick={(a) => {
            e.addSticker(pageId, a);
            void ensureFont(e.defaults.font);
            /* 选完就关面板：它是 1120×560 的底部大抽屉，不关的话刚贴上去的贴纸
               被它整个盖住，用户看不见落点、也没法立刻拖它。想再贴一张重新打开即可。 */
            setPicker(false);
          }}
        />
      ) : null}
    </>
  );
}
