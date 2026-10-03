type ExploreChoiceProps = {
  onQuickView: () => void;
  onExplore: () => void;
  onQuickIntent?: () => void;
  onExploreIntent?: () => void;
};

export function ExploreChoice({ onQuickView, onExplore, onQuickIntent, onExploreIntent }: ExploreChoiceProps) {
  return (
    <main className="explore-choice" aria-labelledby="explore-choice-title">
      <div className="explore-choice__glow" aria-hidden="true" />
      <div className="explore-choice__grain" aria-hidden="true" />

      <header className="explore-choice__header">
        <span>SUN XI / PORTFOLIO</span>
        <span>SELECT MODE</span>
      </header>

      <section className="explore-choice__panel">
        <p className="explore-choice__eyebrow">WELCOME, VISITOR</p>
        <h1 id="explore-choice-title">HOW DO YOU WANT TO EXPLORE?</h1>
        <p className="explore-choice__zh">你想如何浏览？</p>

        <div className="explore-choice__options">
          <button className="explore-choice__option" type="button" onClick={onQuickView} onPointerDown={onQuickIntent} onPointerEnter={onQuickIntent} onFocus={onQuickIntent}>
            <span className="explore-choice__number">01</span>
            <span className="explore-choice__copy">
              <strong>QUICK VIEW</strong>
              <span className="explore-choice__label">快速浏览</span>
              <span className="explore-choice__description">
                A concise archive of experience and selected works
              </span>
              <span className="explore-choice__description-zh">快速查看经历与代表作品</span>
            </span>
            <span className="explore-choice__enter" aria-hidden="true">ENTER</span>
          </button>

          <button className="explore-choice__option" type="button" onClick={onExplore} onPointerDown={onExploreIntent} onPointerEnter={onExploreIntent} onFocus={onExploreIntent}>
            <span className="explore-choice__number">02</span>
            <span className="explore-choice__copy">
              <strong>EXPLORE</strong>
              <span className="explore-choice__label">自由探索</span>
              <span className="explore-choice__description">
                Enter the studio and discover objects
              </span>
              <span className="explore-choice__description-zh">进入工作室，探索我的个人世界</span>
            </span>
            <span className="explore-choice__enter" aria-hidden="true">ENTER</span>
          </button>
        </div>
      </section>

      <footer className="explore-choice__footer">
        <span>ONE WORLD · TWO WAYS IN</span>
        <span>2026</span>
      </footer>
    </main>
  );
}
