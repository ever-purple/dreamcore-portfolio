import { Sparkles } from '@/components/Sparkles';

type Point = {
  /** 前置小标签：视角 / 洞察 / 实践 */
  label: string;
  text: string;
};

type Direction = {
  icon: string;
  title: string;
  en: string;
  points: Point[];
};

/** 开篇：一句话说清想成为什么样的营销人 */
const LEAD =
  '我希望成长为一个能够应对多样化商业需求、总能琢磨出合适解法的复合型营销人。对于我而言，最大的成就感从来不只停留在漂亮的脑洞，而是亲历完整链路，从想法萌芽，推动落地，到最终看见真实的数据反馈，看见内容真正触达到人，这让我有极大的满足感和成就感。';

/** 三个探索方向：每条都按「视角 → 洞察/实践」两层展开 */
const DIRECTIONS: Direction[] = [
  {
    icon: '🎮',
    title: '游戏与社群生态',
    en: 'Gaming & Community',
    points: [
      { label: '视角', text: '相比玩法本身，我更痴迷于玩家社区的二次创作与社群生命力。' },
      {
        label: '洞察',
        text: '以《燕云十六声》为例，打动我的是玩家在社交平台产出的低脂梗图，以及像 GitHub 开源社区一样分享、二次改造建筑图纸的共创生态；加上官方高频的线下联动（如西湖活动），让普通玩家产生极强的参与感。我希望能将这种去中心化的 UGC 共创与玩家归属感应用到营销中。',
      },
    ],
  },
  {
    icon: '👟',
    title: '潮流与 IP 视觉',
    en: 'Trend & IP Branding',
    points: [
      { label: '视角', text: '审美完整、有记忆点的品牌表达，是我极具热情的领域。' },
      {
        label: '洞察',
        text: '我热爱设计，每当看到品牌搭建出完整的自有 IP 体系或出彩的跨界联名，总会忍不住拆解背后的策划逻辑。我渴望参与到从“概念设定”到“品牌符号塑造”的落地项目中。',
      },
    ],
  },
  {
    icon: '🤖',
    title: 'AI 提效与产品落地',
    en: 'AI & Production',
    points: [
      { label: '视角', text: 'AI 是我放大脑中想法的杠杆。' },
      {
        label: '实践',
        text: '虽然我不懂代码、不会绘画，但依靠 AI 独立搭建出了这个个人网站与小产品。它让我的创意有了落地的机会。我仍然需要学习编程知识，这对我进行创作很有必要，也期待未来能与各有所长的伙伴协作，把想法完成得更加完整漂亮。',
      },
    ],
  },
];

const OUTRO =
  '期待在实战里边做边学，遇见更多有意思的项目。如果你对这些方向有共鸣，或是有合作机会，欢迎随时留言聊聊！';

/**
 * 「职业愿景」内容区。
 *
 * 版式与「自我介绍」面板同构（共用 `.about-sheet` 那套外壳 → 底边与左右两栏严格齐平），
 * 但字体规则不同：**标题走 Cubic 11 像素字，正文走思源黑体**——
 * 像素字负责"像一份游戏存档"的骨骼，思源黑体负责长段中文的阅读舒适度。
 */
export function AboutCareerVision() {
  return (
    <div className="about-cv">
      <header className="about-cv-head">
        <h3 className="about-cv-title">
          <span className="about-cv-title-icon" aria-hidden="true">
            🌟
          </span>
          职业愿景
        </h3>
        <span className="about-cv-title-en">career vision</span>
      </header>

      <p className="about-cv-lead">{LEAD}</p>

      <section className="about-cv-sec">
        {/* 滚动提示骑在"探索方向"上方那条虚线上（和自我介绍面板同一个做法） */}
        <footer className="about-cv-foot" aria-hidden="true">
          ▼ 滚动查看完整方向
        </footer>

        <h4 className="about-cv-sec-title">
          <span className="about-cv-sec-icon" aria-hidden="true">
            💡
          </span>
          探索方向
          <em>Focus &amp; Interests</em>
        </h4>

        <ul className="about-cv-dirs">
          {DIRECTIONS.map((d) => (
            <li className="about-cv-dir" key={d.title}>
              <h5 className="about-cv-dir-title">
                <span className="about-cv-dir-icon" aria-hidden="true">
                  {d.icon}
                </span>
                {d.title}
                <em>{d.en}</em>
              </h5>
              <dl className="about-cv-points">
                {d.points.map((p) => (
                  <div className="about-cv-point" key={p.label}>
                    <dt className="about-cv-point-label">{p.label}</dt>
                    <dd className="about-cv-point-body">{p.text}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="about-cv-sec">
        <h4 className="about-cv-sec-title">
          <span className="about-cv-sec-icon" aria-hidden="true">
            🤝
          </span>
          写在最后
          <em>Let&#39;s Connect</em>
        </h4>
        <p className="about-cv-outro">{OUTRO}</p>
        <Sparkles count={6} seed={41} />
      </section>
    </div>
  );
}
