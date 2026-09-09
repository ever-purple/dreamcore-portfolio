import { useCallback, useState } from 'react';
import { ObjectZone } from '@/components/ObjectZone';
import { StudioCursor } from '@/components/StudioCursor';
import { NotebookOverlay } from '@/components/NotebookOverlay';
import { studioObjects, type StudioObject } from '@/data/studio';

type Props = {
  onSelectObject?: (object: StudioObject) => void;
};

/**
 * Studio 主空间：静态底图（无缝循环视频平铺），无视差。
 * - 自定义奶白手型光标跟随鼠标
 * - 四个隐形感应区：鼠标靠近物件时弹出点击按钮（按钮 = 物体名，tooltip = 板块）
 * - 点击笔记本：原地打开线圈本弹层（纸张右侧滑入 + 背景模糊）
 */
export function StudioSection({ onSelectObject }: Props) {
  const [hoveredId, setHoveredId] = useState<StudioObject['id'] | null>(null);
  const [forcePointing, setForcePointing] = useState(false);
  const [notebookOpen, setNotebookOpen] = useState(false);

  const pointing = hoveredId !== null || forcePointing;

  const handleSelect = useCallback(
    (object: StudioObject) => {
      if (object.id === 'notebook') setNotebookOpen(true);
      onSelectObject?.(object);
    },
    [onSelectObject],
  );

  const handleZoneHover = useCallback(
    (id: StudioObject['id'], hovering: boolean) => setHoveredId(hovering ? id : null),
    [],
  );

  return (
    <section className="studio-scope relative h-screen w-full overflow-hidden bg-wine-dark">
      {/* 底图：循环视频，平铺全屏 */}
      <div className="absolute inset-0">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          poster="/studio/studio-poster.jpg"
        >
          <source src="/studio/studio-loop.mp4" type="video/mp4" />
        </video>
      </div>

      {/* 四个物件悬停感应区（隐形，中心为脉冲提醒点） */}
      {studioObjects.map((object) => (
        <ObjectZone
          key={object.id}
          object={object}
          onSelect={handleSelect}
          onHoverChange={handleZoneHover}
        />
      ))}

      {/* 氛围暗角 */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />

      {/* 顶部导航 */}
      <header className="absolute inset-x-0 top-0 flex items-center justify-between p-6 md:p-8">
        <p className="font-display text-lg tracking-[0.2em] text-cream">MY STUDIO</p>
        <nav
          className="flex items-center gap-5"
          onMouseEnter={() => setForcePointing(true)}
          onMouseLeave={() => setForcePointing(false)}
        >
          {['WORKS', 'ABOUT', 'CREATIVE LAB', 'CONTACT', 'RESUME'].map((item) => (
            <a
              key={item}
              href="#"
              className="hidden text-[11px] tracking-[0.15em] text-cream/75 transition-colors hover:text-cream md:block"
            >
              {item}
            </a>
          ))}
          <button
            type="button"
            className="rounded-full border border-cream/30 px-4 py-1.5 text-[11px] tracking-[0.15em] text-cream transition-colors hover:border-cream/70"
          >
            MENU
          </button>
        </nav>
      </header>

      {/* 自定义手型光标（z 最高） */}
      <StudioCursor pointing={pointing} />

      {/* 线圈本弹层 */}
      <NotebookOverlay
        open={notebookOpen}
        onClose={() => setNotebookOpen(false)}
        onHoverChange={setForcePointing}
      />
    </section>
  );
}
