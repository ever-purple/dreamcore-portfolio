/**
 * 手账编辑器 —— 单个图层的渲染
 * =============================================================================
 * 同一份图层数据要在**两条渲染路径**下都长得一模一样：
 *
 *   mode='band' —— 阅读态的 12 条竖带里。每条带是一份完整纸面的切片，所以这里必须
 *                  纯静态、无状态、无 `<video>`：
 *                    · 图片 → `<img>`（12 份同 URL，浏览器只解码一次）
 *                    · 文字 → 普通 DOM 文字
 *                    · 视频 → **只画 poster 静帧**。真 `<video>` ×12 太重；
 *                      真正能播的那一份由 `.dp-live` 覆盖层提供（见 NotebookOverlay）。
 *   mode='live' —— 编辑态的单页 / 阅读态的覆盖层。视频是真 `<video controls>`。
 *
 * ⚠️ 两条路径共用 `layerBox()` 定位，坐标必须逐像素一致，否则翻页时贴纸会跳。
 */

import type { CSSProperties } from 'react';
import type { DiaryLayer, LayerImage, LayerVideo } from '@/lib/diary-editor/types';
import { cropInnerStyle, displayAspect, layerBox, textFontSize, TEXT_LINE_HEIGHT } from '@/lib/diary-editor/layout';
import { familyOf } from '@/lib/diary-editor/fonts';

type Props = {
  layer: DiaryLayer;
  mode: 'band' | 'live';
  /** 编辑态：不接管指针（拖拽由 DiaryCanvas 统一处理），只画出来 */
  passive?: boolean;
};

function MediaShell({
  layer,
  children,
  caption,
}: {
  layer: LayerImage | LayerVideo;
  children: React.ReactNode;
  caption?: React.ReactNode;
}) {
  const frame = layer.frame;
  /**
   * 四格相框（2026-09-23 加）：2×2 四个窗口，**只有图片图层**真正四格化
   * （视频套上它只当蓝底框渲染，走原路）。每格显示 `quadCells[i]`，
   * 没单独换过的格子回退主图 src —— 刚套上时四格是同一张图，
   * 用户逐格双击换图（写 quadCells[i]，见 DiaryCanvas 的 quadIndexOf）。
   */
  const isQuad = layer.type === 'image' && frame === 'quad';
  /* 圆形裁切与四格相框都强制正方形（quad 是 2×2 方阵），否则会被拉成长条 */
  const aspect = frame === 'circle' || isQuad ? 1 : displayAspect(layer) || 1;
  /**
   * 拖过边手柄的贴纸有明确高度（`layer.h`，见 types.ts 的 LayerBase.h）——
   * 这时 `.dp-media` 铺满外框，图片用 `object-fit: cover` 填满：
   * 用户把框拉宽/拉高，图跟着变（不变形、不留白）。
   * 没拉过 = 高度仍由纵横比决定，与旧版逐像素一致。
   */
  const fixedH = layer.h !== undefined;
  return (
    <div className={`dp-layer dp-frame is-${frame}`} style={layerBox(layer)} data-dp-layer={layer.id}>
      {isQuad ? (
        <div className="dp-media is-quad" style={fixedH ? { height: '100%' } : { aspectRatio: String(aspect) }}>
          {[0, 1, 2, 3].map((i) => (
            <span className="dp-quad-cell" key={i}>
              <img
                className="dp-img"
                src={layer.quadCells?.[i]?.src || layer.src}
                alt=""
                draggable={false}
                /* 四格各自铺满：裁切(crop)与 cover 都不作用于格子 ——
                   crop 是"整张主图的取景"，对四格拼贴没有意义 */
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </span>
          ))}
        </div>
      ) : (
        <div className="dp-media" style={fixedH ? { height: '100%' } : { aspectRatio: String(aspect) }}>
          {children}
        </div>
      )}
      {frame === 'polaroid' || frame === 'retro' || frame === 'card' ? (
        <figcaption className="dp-cap">{caption ?? layer.caption ?? '　'}</figcaption>
      ) : null}
    </div>
  );
}

export function LayerView({ layer, mode, passive }: Props) {
  const ptr: CSSProperties = passive ? { pointerEvents: 'none' } : {};

  if (layer.type === 'text') {
    return (
      <div
        className={`dp-layer dp-textlayer is-${layer.box}${layer.bold ? ' is-bold' : ''}${layer.italic ? ' is-italic' : ''}`}
        style={{ ...layerBox(layer), ...ptr }}
        data-dp-layer={layer.id}
      >
        <div
          className="dp-text"
          style={{
            fontFamily: familyOf(layer.font),
            fontSize: textFontSize(layer.size),
            lineHeight: TEXT_LINE_HEIGHT,
            color: layer.color,
            /* 对齐（用户 2026-09-23：「可以调整对齐」）—— 与结构文字共用同一个控件，
               所以两种对象都得认这个值，否则"选了贴纸点居中没反应"。 */
            ...(layer.align ? { textAlign: layer.align } : null),
          }}
        >
          {layer.text || ''}
        </div>
      </div>
    );
  }

  if (layer.type === 'image') {
    return (
      <MediaShell layer={layer} caption={layer.caption}>
        {layer.src ? (
          <img
            className="dp-img"
            src={layer.src}
            alt={layer.caption ?? ''}
            draggable={false}
            /* 自由拉过框时用 cover 填满（不变形、不留白）；裁切过的走 cropInnerStyle 的
               放大+偏移机制，两者不能同时用，所以这里互斥。 */
            style={{
              ...cropInnerStyle(layer.crop),
              ...(layer.h !== undefined && !layer.crop ? { objectFit: 'cover' as const } : null),
            }}
          />
        ) : (
          <span className="dp-missing">图片已不在本机</span>
        )}
      </MediaShell>
    );
  }

  /* video */
  return (
    <MediaShell layer={layer} caption={layer.caption}>
      {mode === 'live' && layer.src ? (
        <video
          className="dp-video"
          src={layer.src}
          poster={layer.poster}
          controls
          playsInline
          preload="metadata"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : layer.poster ? (
        /* 静态态只给 poster —— 12 条带各一份也不会挂 12 个解码器 */
        <img className="dp-img" src={layer.poster} alt={layer.caption ?? ''} draggable={false} />
      ) : (
        <span className="dp-missing">视频</span>
      )}
    </MediaShell>
  );
}

/**
 * 阅读态的"活视频"覆盖层 —— 挂在 `.diary-flip` 里（**屏幕空间**，与纸面同一坐标系：
 * 静止时纸正好铺满 .diary-flip，所以百分比定位直接对得上）。
 * 只渲染当前页的视频图层；翻页期间整层隐藏（那时由 12 条带里的 poster 顶着，
 * 贴纸会跟着纸一起弯，视觉上无缝）。
 */
export function LiveVideoLayer({ layers, hidden }: { layers: DiaryLayer[]; hidden: boolean }) {
  const videos = layers.filter((l) => l.type === 'video');
  if (!videos.length) return null;
  return (
    <div className={`dp-live${hidden ? ' is-hidden' : ''}`} aria-hidden={hidden || undefined}>
      {videos.map((l) => (
        <LayerView key={l.id} layer={l} mode="live" />
      ))}
    </div>
  );
}
