import { Sparkles } from '@/components/Sparkles';

/** 角色主档 */
const CHAR = {
  name: '孙晨茜',
  level: 22,
  tagline: '短视频 / 整合营销 / AI 提效',
  school: '天津传媒学院｜广告学',
  email: '1952200284@qq.com',
  board: '「留言板」留下消息',
};

/** 角色基础属性（装饰性数值，对应热情/灵感/经验） */
const STATS = [
  { label: '热情', en: 'HP', value: 92 },
  { label: '灵感', en: 'MP', value: 88 },
  { label: '经验', en: 'EXP', value: 76 },
];

/** 实习副本（按时间倒序展示更"当前"） */
const DUNGEONS = [
  { org: '北京新白文化', period: '26.01–04', role: '市场部', desc: '矩阵账号、投放分析、达人对接、AI 提效' },
  { org: '北京行行行广告', period: '25.07–08', role: '整合营销', desc: '服务快手、神州租车，亿级曝光营销' },
  { org: '北京氪星创服', period: '24.07–09', role: '品牌市场部', desc: '短视频、多平台运维，大型项目传播' },
  { org: '天津伊甸园', period: '23.07–09', role: '新媒体运营', desc: '短视频 / 文案' },
];

/** 技能树：熟练度 5 格 */
const SKILLS = [
  { name: '整合营销策划', lv: 5 },
  { name: '短视频全链路', lv: 5 },
  { name: '文案撰写 / PPT 提案美化', lv: 4 },
  { name: '达人对接管理 / 投放数据复盘', lv: 4 },
  { name: '抖音来客 / 蒲公英 / 巨量聚光', lv: 5 },
  { name: 'AI 工具', lv: 4 },
];

const PASSIVES = [
  '热点 & 受众心理感知敏锐',
  '拆解模糊需求，落地执行',
  '多任务处理，大型项目执行输出',
  '主动自学工具提升工作效率',
];

const TRAITS = ['对内容细节标准较高，预留打磨时间', '新业务习惯充分调研后输出方案'];

const DAILY = ['追热点', '做内容', '测试 AI', '项目复盘'];
const CURRENT_QUEST = '期待新合作实践机会';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * 「自我介绍」内容区 —— 游戏角色面板（RPG 风格）。
 * 结构：角色主档（LV/职业/属性条/联络）→ 实习副本 → 技能树 → 被动天赋 → 特质局限 → 日常状态。
 * 面板自身可滚动（固定高度像游戏窗口），滚动条沿用薄荷绿。
 */
export function AboutCharacterSheet() {
  return (
    <section className="about-sheet" aria-label="角色档案">
      {/* 角色主档 */}
      <header className="about-sheet-head">
        <div className="about-sheet-badge" aria-label={`等级 ${CHAR.level}`}>
          <span>LV</span>
          <strong>{CHAR.level}</strong>
        </div>
        <div className="about-sheet-id">
          <h3 className="about-sheet-name">{CHAR.name}</h3>
          <p className="about-sheet-tagline">{CHAR.tagline}</p>
          <p className="about-sheet-clear-count">
            已通关实习副本 <b>×{DUNGEONS.length}</b>
          </p>
        </div>
      </header>

      {/* 属性条 */}
      <div className="about-sheet-stats">
        {STATS.map((s) => (
          <div className="about-sheet-stat" key={s.en}>
            <span className="about-sheet-stat-label">
              {s.label}
              <em>{s.en}</em>
            </span>
            <span className="about-sheet-stat-track">
              <i style={{ width: `${s.value}%` }} />
            </span>
            <span className="about-sheet-stat-val">{s.value}</span>
          </div>
        ))}
      </div>

      {/* 联络信息 */}
      <dl className="about-sheet-info">
        <div>
          <dt>SCHOOL</dt>
          <dd>{CHAR.school}</dd>
        </div>
        <div>
          <dt>✉ MAIL</dt>
          <dd>
            <a href={`mailto:${CHAR.email}`}>{CHAR.email}</a>
          </dd>
        </div>
        <div>
          <dt>💬 BOARD</dt>
          <dd>{CHAR.board}</dd>
        </div>
      </dl>

      {/* 实习副本 */}
      <section className="about-sheet-sec">
        {/* 滚动提示坐在"实习副本"上方那条虚线上（原来在面板最底部） */}
        <footer className="about-sheet-foot" aria-hidden="true">
          ▼ 滚动查看完整档案
        </footer>
        <h4 className="about-sheet-sec-title">
          <span aria-hidden="true">📜</span> 实习副本 <em>DUNGEON LOG</em>
          <i>{DUNGEONS.length}/{DUNGEONS.length} CLEARED</i>
        </h4>
        <ol className="about-sheet-quests">
          {DUNGEONS.map((d, i) => (
            <li key={d.org}>
              <span className="about-sheet-quest-no">副本 {pad2(i + 1)}</span>
              <div className="about-sheet-quest-main">
                <p className="about-sheet-quest-line">
                  <b>◆ {d.org}</b>
                  <span className="about-sheet-quest-period">{d.period}</span>
                  <em className="about-sheet-quest-role">{d.role}</em>
                </p>
                <p className="about-sheet-quest-desc">{d.desc}</p>
              </div>
              <span className="about-sheet-cleared">CLEARED</span>
            </li>
          ))}
        </ol>
      </section>

      {/* 技能树 */}
      <section className="about-sheet-sec">
        <h4 className="about-sheet-sec-title">
          <span aria-hidden="true">⚔</span> 技能树 <em>SKILL TREE</em>
          <i>{SKILLS.length} SKILLS</i>
        </h4>
        <ul className="about-sheet-skills">
          {SKILLS.map((s) => (
            <li key={s.name}>
              <span className="about-sheet-tick" aria-hidden="true">
                ✔
              </span>
              <span className="about-sheet-skill-name">{s.name}</span>
              <span className="about-sheet-skill-lv" aria-label={`熟练度 ${s.lv} / 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <b key={n} className={n <= s.lv ? 'is-on' : ''} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 被动天赋 */}
      <section className="about-sheet-sec">
        <h4 className="about-sheet-sec-title">
          <span aria-hidden="true">✨</span> 被动天赋 <em>PASSIVE</em>
          <i>{PASSIVES.length} ACTIVE</i>
        </h4>
        <ul className="about-sheet-list">
          {PASSIVES.map((p) => (
            <li key={p}>
              <span aria-hidden="true">◆</span>
              {p}
            </li>
          ))}
        </ul>
      </section>

      {/* 特质局限 */}
      <section className="about-sheet-sec">
        <h4 className="about-sheet-sec-title">
          <span aria-hidden="true">🛡</span> 特质局限 <em>TRAITS</em>
          <i>NOTE</i>
        </h4>
        <ul className="about-sheet-list about-sheet-list-traits">
          {TRAITS.map((t) => (
            <li key={t}>
              <span aria-hidden="true">◆</span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      {/* 日常状态 */}
      <section className="about-sheet-sec">
        <h4 className="about-sheet-sec-title">
          <span aria-hidden="true">🕹</span> 日常状态 <em>DAILY LOOP</em>
        </h4>
        <div className="about-sheet-daily">
          {DAILY.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <p className="about-sheet-quest-banner">
          <span aria-hidden="true">📌</span> 当前任务：{CURRENT_QUEST}
        </p>
      </section>

      <Sparkles count={5} seed={91} />
    </section>
  );
}
