# Quick View Version 2 全视觉资产重制规范

> 状态：重新开始。此前草地、建筑、树、前景草及物件生图只作为问题参考，不再约束新版视觉。

新版生图**不上传、不参考、不延续上一版草地、建筑、树和前景草图片**。上一版只用于说明为什么需要重做，不能作为视觉输入。新资产从文字规范、Pinterest 风格参考和 Explore 室内物件截图重新建立。

## 0. 整个项目结构

项目根目录：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home
```

```text
dreamcore-loader-home/
├─ src/                                  # 主站与 Explore 正式源码
│  ├─ App.tsx                            # Home / Quick View / Explore 切换
│  ├─ sections/
│  │  ├─ HomeSection.tsx                 # 网站入口与模式选择
│  │  └─ StudioSection.tsx               # Explore 室内工作室
│  ├─ components/
│  │  ├─ StudioLensBackground.tsx        # Explore 室内背景视频
│  │  ├─ WorksCarousel.tsx               # Explore 旋转木马
│  │  ├─ NewsstandScene.tsx              # Explore 报刊亭 3D 场景
│  │  ├─ GreenOs.tsx                     # CRT 内容与屏幕效果
│  │  └─ QuickViewShell.tsx              # 主项目 Quick View
│  ├─ data/studio.ts                     # Explore 物件坐标
│  └─ lib/carousel/                      # 旋转木马 3D 实现
├─ public/                               # 全站公共资产
│  ├─ studio/                            # studio-loop.mp4 / studio-poster.jpg
│  ├─ carousel/                          # Carousel 结构纹理
│  ├─ newsstand/                         # rack 与旧设备 GLB
│  ├─ quick-view/                        # V1 媒体
│  ├─ quick-view-v2/                     # V2 媒体
│  ├─ works/                             # 作品项目图片
│  └─ about / journal / media / fonts
├─ _quickview_preview/                   # Version 1 黑色版，保持不动
├─ _quickview_v2_meadow_preview/         # Version 2 独立开发目录
│  ├─ src/components/QuickViewShell.tsx
│  └─ src/meadow-v2.css
└─ docs/                                 # 本规范与截图说明
```

模式关系：

```text
Home
├─ Version 1 Quick View：现有黑色版，只用于对比
├─ Version 2 Quick View：本次重新制作的室外世界
└─ Explore：现有室内工作室，物件造型参考来源
```

新版资产最终存放：

```text
public/quick-view-v2/rebuild/
├─ world/
├─ building/
├─ desk-crt/
├─ carousel/
├─ newsstand/
├─ foreground/
└─ previews/
```

Explore 物件参考截图已经准备在：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\visual-reference-captures
```

用于上传的四张文件：

```text
01-explore-room-full.png
02-desk-crt-region.png
03-carousel-region.png
04-newsstand-region.png
```

截图只负责物件造型识别。截图中的颗粒、色差、灰雾、暗部和室内光线不得复制到新版外部世界。

## 1. 重制原因

当前方案需要全部重做，主要原因有两点：

1. 整体过于阴沉，灰黑天空、深绿色草地和旧建筑同时出现，压低了作品集内容的亲和力。
2. AI 图片包含大量颗粒、斑点、锐化噪声和不稳定透明边缘，拆层后很难准确拼接，桌面与移动端也难以保持同一个世界。

新版目标：

> 明亮、安静、轻微梦核、真实但不沉重。场景应像晴天转阴之前的柔和自然光，具有日式生活电影的空气感，但图片本身必须干净、低噪点、便于网页合成。

## 2. 新的视觉原则

### 2.1 明亮而不泛白

- 天空使用浅蓝灰或浅暖灰，不使用深铅灰。
- 草地使用柔和黄绿色，不使用大面积墨绿和黑绿。
- 建筑外墙使用暖灰、米灰或浅水泥色。
- 窗户可以有少量暖光，但白天不应像夜景一样全部发亮。
- 画面黑色面积不得超过约 12%。
- 中央内容区域的背景亮度和细节密度必须稳定。

### 2.2 图片禁止自带复古颗粒

所有生图提示中加入：

```text
clean smooth photographic image, low visual noise, no film grain,
no dust speckles, no halftone dots, no paper texture, no scanlines,
no chromatic aberration, no oversharpening, clean tonal gradients
```

禁止：

- 胶片颗粒烘焙进图片。
- 黑色斑点和纸张纹理。
- VHS 扫描线。
- 强色差。
- 高锐化树叶和草叶。
- 伪胶片划痕。

复古效果全部由网页统一添加，而且必须可以关闭。

### 2.3 Pinterest「绿色」画板风格分析

参考画板：

```text
https://jp.pinterest.com/c50356067/绿色/
```

画板的共同点不是简单的“绿色加颗粒”，而是厚实的绿色中间调、柔和高光、生活化构图和自然框景。

#### 色调

- 绿色带黄、橄榄和少量青色，不使用商业草坪式荧光绿。
- 植物暗部接近墨绿或绿棕，亮部偏黄绿。
- 白色偏奶油色、米色或旧纸色，极少出现纯白。
- 暖黄色阳光、木材与少量红色物体作为绿色环境中的互补色。
- 黑色不死黑，保留绿色或棕色信息。

建议色域：

```text
叶片亮部：#7F933E – #A9AC58
草地中间调：#657A38 – #84934B
植物暗部：#17271C – #2A3824
暖阳高光：#E4C57B – #F1D89B
米色建筑：#C8B996 – #D8CFB5
阴影棕色：#463C29 – #5A4931
天空浅灰蓝：#AEBBC0 – #CBD0C7
```

#### 明暗与对比

- 主体附近有明确的中亮度窗口，暗部用来框景。
- 高光柔和压缩，不出现数码式纯白爆点。
- 局部对比高于全局对比，主体轮廓清楚，天空与远景柔和。
- 网站采用画板中明亮花园、草地和窗光的明度方向，不复制最阴暗的树林作为整页基调。

#### 胶片感

提取：厚实绿色中间调、柔和高光滚降、微暖白平衡、轻微绿色阴影和低锐化边缘。

不提取：粗颗粒、扫描斑点、JPEG噪声、划痕和大面积灰雾。网页最后只用 CSS 增加极弱且可关闭的统一颗粒。

#### 构图

- 用树叶、树干、窗框或家具形成自然框景。
- 主体经常偏离正中心，保留环境信息。
- 使用“暗前景—亮中景—柔和远景”的三层关系。
- 近景遮挡较大但数量少，不用许多碎小元素铺满画面。
- Quick View 的中央安全区仍必须干净，框景集中在左右与底部。
- 移动端天空约占 30%–42%，主体位于中部，近景从底部或单侧进入。

#### 焦段

以下是对摄影语言的推断，不是原图 EXIF：

- World Master：全画幅等效 35–45mm，默认 40mm。
- Explore 建筑：45–55mm，默认 50mm，相机保持水平。
- Desk / CRT、Carousel、Newsstand：50–65mm，默认 55–60mm，轻微 3/4 视角。
- 禁止 20–24mm 超广角造成建筑与物件变形。
- 移动端仍模拟 35–45mm，通过重新构图适配竖屏，不能靠超广角塞入内容。

#### 光圈与景深

- 世界背景：f/5.6–f/8，路径、建筑和草地层次可辨认。
- 单独物件：f/4–f/5.6，主体前后大部分保持清楚。
- 不用 f/1.4 式夸张虚化，不制造人像模式抠边。

#### 曝光与白平衡

- 模拟 ISO 100–400 的干净底片。
- 户外模拟 1/125s–1/250s，避免草叶大片拖影。
- 高光保留约 0.5–1 档余量。
- 白平衡约 5000K–5600K；暖阳版本约 4800K–5200K。
- Tint 可轻微偏绿，但建筑与天空不能整体发绿。

最终目标：

> 温暖空气中的橄榄绿和黄绿色，奶油色高光，阴影略偏绿棕；具有旧电影的色彩响应，但图片本身干净、平滑、没有粗颗粒。

### 2.4 先做母版，再拆层

不能再分别生成天空、草地、树和建筑后强行拼接。

正确流程：

```text
桌面 World Master
↓
确认构图、光线、建筑、路径和中央安全区
↓
从同一张母版拆出背景、建筑和前景

移动 World Master
↓
沿用同一地点、建筑和光线
↓
从移动母版拆层
```

这样可以避免：

- 地平线不一致。
- 天空出现拼接线。
- 建筑悬浮。
- 光线方向不一致。
- 不同资产拥有不同颗粒。

## 3. 新世界设定

### 3.1 时间与天气

- 时间：下午 3–5 点。
- 天气：明亮薄云或雨后将晴。
- 光线：大面积柔光，没有强烈直射阳光。
- 空气：清晰中带轻微远景薄雾。
- 情绪：平静、轻盈、有一点不现实，但不恐怖。

### 3.2 场地

- 一片略微起伏的开阔草地。
- 中央有自然形成的浅色小路，通向 Explore 建筑入口。
- 地平线清楚但柔和。
- 中央区域不放大树、高对比花丛、强阴影或密集建筑细节。
- 两侧可以有少量树木或灌木形成取景框。

### 3.3 Explore 建筑

- 一栋浅暖灰色的小型艺术工作室建筑。
- 比当前建筑更亲和、更轻盈。
- 保留少量装饰艺术或旧校园建筑特征。
- 有明确正门、一个圆窗或标志性高窗。
- 结构不能过度宏伟，避免庄园、城堡、医院和恐怖学校感。
- 外墙可以有少量藤蔓，但不能大面积腐败、发黑或开裂。

## 4. 中央内容安全区

场景生成时必须主动留出内容区。

### 桌面

```text
绝对安全区：X 27%–73%，Y 18%–82%
弹性安全区：X 18%–82%，Y 12%–88%
```

绝对安全区内只能出现：

- 低对比草地。
- 小路。
- 柔和天空。
- 低对比远景建筑。

禁止出现：

- 大树树干。
- 高对比树冠。
- 物件边缘。
- 强烈窗灯。
- 高对比阴影。

### 移动端

```text
绝对安全区：X 10%–90%，Y 15%–85%
```

移动画面中心需要比桌面更干净。树和大型物件主要从左右边缘进入，不应横跨屏幕中心。

## 5. 简化后的分层架构

新版不再追求大量小图层。每个端只保留必要层。

```text
01 World Background
02 Explore Building
03 Scene Object
04 Foreground Occlusion
05 Web Color Grade / Grain
06 UI Content
```

同时出现的透明场景物件最多两个。不能让 Desk、Carousel、Newsstand 同时堆在画面中。

## 6. 第一阶段：世界母版资产

### 6.1 桌面 World Master

文件：

```text
world-master-desktop.png
```

规格：

- 2560×1440。
- 16:9。
- 完整合成预览图。
- 无颗粒、无扫描线、无暗角。
- 展示天空、草地、路径、建筑和两侧自然景物。
- 建筑在远处，正门与路径对齐。
- 中央必须满足安全区要求。

用途：先确认整个世界是否成立。这张图不直接用于最终动画拆层前的生产。

### 6.2 移动 World Master

文件：

```text
world-master-mobile.png
```

规格：

- 1440×2560。
- 9:16。
- 与桌面母版为同一地点、同一建筑、同一时间和光线。
- 不是简单裁切桌面图，要重新安排两侧树木和建筑比例。
- 正门仍与路径对齐。

### 6.3 母版验收标准

- 两张图第一眼看起来是同一个地点。
- 建筑形状、门窗、圆窗和塔楼完全一致。
- 地平线高度在两端保持逻辑一致。
- 不依赖颗粒就能成立。
- 草地没有大量点状高光。
- 天空渐变平滑，没有明显横线。
- 建筑真实落在地面上。
- 内容安全区不被抢占。

## 7. 第二阶段：从母版拆出的最终世界层

母版通过后再制作以下文件。

### 7.1 背景 Clean Plate

```text
world-background-desktop.webp
world-background-mobile.webp
```

包含：

- 天空。
- 远山或远处树线。
- 草地。
- 路径。
- 中远景环境。

不包含：

- Explore 建筑。
- 近景大树。
- 前景草遮挡。
- Desk、Carousel、Newsstand。

尺寸：

- 桌面 2560×1440。
- 移动 1440×2560。

### 7.2 Explore 建筑

```text
building-desktop.webp
building-mobile.webp
building-window-light.webp
building-shadow.webp
```

要求：

- 从母版中的同一栋建筑拆出或重绘。
- 透明背景。
- 建筑底边贴图像内容边界，不能保留大块透明画布。
- 桌面和移动为同一栋建筑。
- 建筑本体不包含远景雾。
- 窗户微光单独输出。
- 地面阴影单独输出。

建筑不再制作 Far / Near 两套造型。滚动靠同一高清建筑做缩放，减少对接成本。输出尺寸需要支持约 2.2 倍放大：

- 桌面建筑建议宽度 2200–2600px。
- 移动建筑建议宽度 1600–1900px。

### 7.3 两侧自然取景层

```text
edge-foliage-desktop.webp
edge-foliage-mobile.webp
```

要求：

- 从母版两侧自然景物中拆出。
- 尽量合成一个统一边缘层，不再分别制作树和多组灌木。
- 透明背景。
- 只负责轻微横向视差。
- 不跨越中央绝对安全区。

### 7.4 前景遮挡层

```text
foreground-grass-desktop.webp
foreground-grass-mobile.webp
```

要求：

- 从母版前景拆出。
- 透明背景。
- 桌面高度约视口 10%–16%。
- 移动高度约视口 12%–18%。
- 草叶轮廓要简洁，避免大量细碎透明毛边。
- 用于遮挡物件底脚和提供最近景视差。

## 8. 第三阶段：三个 Explore 呼应物件

所有物件先确认造型，再生成透明成品。每件只做一个高清主体版本，桌面和移动优先通过网页构图复用；只有裁切确实失败时才制作移动专版。

### 8.1 Desk / CRT

```text
desk-crt.webp
desk-crt-screen.webp
desk-crt-shadow.webp
```

主体要求：

- 保持 Explore 左侧 Desk / CRT 的核心造型。
- 可以简化桌面小物。
- 真实室外摄影质感。
- 光线与 World Master 完全一致。
- 透明背景。
- 桌脚完整且底边紧贴主体。
- 不包含草地。
- CRT 屏幕保持暗色。

独立屏幕层：

- 只包含 CRT 屏幕发光区域。
- 透明背景。
- 用于 About 中渐亮、Experience 中熄灭。

阴影层：

- 柔边、低对比。
- 不包含草叶和主体。
- 网页使用 `mix-blend-mode: multiply`。

建议主体画布：2000×1700。

### 8.2 Carousel

```text
carousel.webp
carousel-light.webp
carousel-shadow.webp
```

主体要求：

- 保持 Explore 旋转木马的顶棚、中心立柱、马匹和配色识别。
- 真实摄影质感。
- 不得生成大型游乐园木马。
- 透明背景。
- 主体不自带光晕和地面。
- 底边紧贴主体。

灯光层：

- 只包含灯带和灯泡。
- 不包含木马实体。
- 用于先出现远处暖光，再出现主体。

建议主体画布：2200×2000。

### 8.3 Newsstand

```text
newsstand.webp
newsstand-shadow.webp
```

主体要求：

- 参考 Explore 的 rack 展架。
- 保留陈列架、书刊和旧媒体设备的组合特征。
- 不生成小卖部、便利店或带大型顶棚的街边亭。
- 透明背景。
- 不需要独立发光层。
- 底边紧贴主体。

建议主体画布：1900×1900。

## 9. 每项资产都必须同时交付的预览

为了减少透明图对接失败，每项主体需要交付：

```text
xxx-preview.jpg       # 放在新版 World Master 上的合成预览
xxx.webp              # 透明主体
xxx-shadow.webp       # 独立阴影
```

Carousel 和 CRT 额外包含灯光层。

合成预览的作用是先验证：

- 透视是否正确。
- 光线是否一致。
- 大小是否合理。
- 是否真正接地。
- 透明边缘是否自然。

只有预览通过后，透明主体才视为可用。

## 10. 透明资产技术要求

- 优先交付无损 PNG，再由项目统一转 WebP。
- Alpha 边缘不得带白边、黑边或原背景残色。
- 主体四周保留 2%–4% 安全边距即可。
- 主体底部不得保留超过 4% 的透明空白。
- 阴影不与主体烘焙。
- 不使用生成式透明棋盘格背景。
- 不允许把纯黑或纯白背景误当透明。
- 所有资产采用 sRGB。

## 11. 推荐的简化滚动场景

### Intro

- World Background。
- 建筑远景。
- 无大型物件。

### About

- Desk / CRT 从左侧边缘进入。
- CRT 屏幕微亮。
- 建筑缓慢放大。

### Experience

- Desk 向左后方退去。
- Carousel Light 先在远处出现。
- 后半段才出现 Carousel 主体。

### Works

- Carousel 成为主要环境物件。
- 不同时出现 Newsstand。

### Contact

- Carousel 退场。
- Newsstand 位于一侧。
- 建筑靠近，正门成为主要目标。
- 窗灯轻微变亮。

### Ending

- Newsstand 退到边缘。
- 建筑正门与 `ENTER EXPLORE` 对齐。

## 12. 保持不变的网页内容

- About 的 ID Card 和介绍文字。
- Experience 的连线小猫和节点。
- Works 的项目选择和封面。
- Contact 的联系方式和 `ENTER EXPLORE`。
- 四个章节的顺序。
- Explore 室内现有物件的核心识别。

视觉资产完成前不重新决定内容排版。先用场景资产建立滚动原型，再调整各段内容的位置。

## 13. 彻底废弃的旧做法

- 分别生天空、草地、树和建筑。
- 让 AI 自动在每张图上添加胶片颗粒。
- 桌面和移动分别生成完全不同的建筑。
- 同一个物件制作多个造型不一致的远近版本。
- 用大面积黑色遮罩掩盖素材噪点。
- 用雾遮住建筑悬浮和透明边缘。
- 每个栏目更换完整背景图。
- 把内容文字画进场景。

## 14. 制作顺序

严格按以下顺序，不并行生成多个方向：

1. 桌面 World Master。
2. 移动 World Master。
3. World Background、Building、Edge Foliage、Foreground Grass 拆层。
4. Desk / CRT 主体、屏幕和阴影。
5. Carousel 主体、灯光和阴影。
6. Newsstand 主体和阴影。
7. 网页滚动场景原型。
8. 根据真实滚动遮挡调整内容排版。
9. 最后由网页统一加入非常轻的颗粒、褪色和扫描线。

## 15. World Master 生图提示词基础版

```text
A bright, quiet meadow outside a small art studio building, seen in soft
late-afternoon diffused daylight. A pale natural footpath leads
from the lower center toward the building entrance. The building is warm
light-gray concrete with subtle art-deco and old-campus architecture, one
recognizable round window, a modest tower, clean walls with only a small
amount of ivy, welcoming rather than haunted. Soft yellow-green meadow,
light blue-gray sky, clear gentle atmosphere, restrained Japanese independent
live-action film composition, realistic photography, natural lens, soft tonal
range, calm and slightly dreamlike, large clean central negative space for web
content, low detail density in the center.

Simulated full-frame 40mm lens, f/5.6, natural perspective, level camera,
soft highlight roll-off, olive and yellow-green midtones, creamy warm
highlights, subtle green-brown shadows. Clean smooth photographic image,
low visual noise, no baked-in film grain, no dust
speckles, no halftone dots, no paper texture, no scanlines, no chromatic
aberration, no oversharpening, clean tonal gradients, no horror, no abandoned
building, no castle, no hospital, no mansion, no dramatic storm clouds, no
dark teal color grading, no text, no people.
```

这段只是母版起点。实际生成时还需指定桌面或移动构图，以及安全区位置。
<!-- DREAMCORE-DIRECTION-START -->

## 梦核反常设定（最终收敛版）

新版场景只保留两个反常元素：**低空漂浮的 Explore 屋子**与**一组从云里垂下来的窗帘**。草地、树木和基础天空保持真实、明亮、干净。梦核感来自少量明确的空间矛盾，不使用阴暗、噪点、斑驳、故障或大量奇幻物件制造气氛。

### 1. 低空漂浮的 Explore 屋子

- 它是整个 Quick View 唯一常驻的主异常，也是滚动旅程的目的地。
- 外形、材料、门窗比例和标志性细节应来自 Explore 全景截图，使用户能认出它与 Explore 属于同一空间体系。
- 建筑整体离开草地，建筑下缘与地面之间必须存在清楚的空气间隔；不要画成地基没有贴地的生图错误。
- 漂浮高度保持克制，不做天空城堡。建筑仍应像一座普通、可进入的屋子，只是失去了重力。
- Hero 与 About 阶段处于远景；Experience 和 Projects 阶段逐渐变清晰、略微变大；Contact 阶段靠近入口。
- 建筑的位置和尺度变化主要由网页端的 `translate`、`scale`、雾化与明暗控制完成，不为每个章节生成一张不同建筑图。

### 2. 从云里垂下来的窗帘

- 全站只出现一组，由左右两片半透明薄纱构成。
- 上端隐入云层，看不到窗框、轨道、屋顶、绳索或其他支撑结构。
- 下端悬在空中，不接触草地。
- 材质为奶油白或极浅的黄绿色旧薄纱，轻微透光，避免婚礼纱幔、舞台幕布或宫廷窗帘的感觉。
- 前半段不完整展示；中后段才从云雾里逐渐显现；Contact 阶段左右缓慢分开，露出漂浮屋子的入口。
- 摆动幅度很小，像几乎没有风。不能持续大幅飘舞，以免与内容争夺注意力。
- 窗帘始终位于中央内容安全区的外围；只有进入 Explore 的最终转场允许它短暂经过画面中央。

### 3. 明确删除的异常元素

以下元素不进入本轮资产与生图提示词：

- 空中的金鱼及鱼影
- 天空水波纹和水下焦散
- 草地斑马线、地砖、公交站或无边界水面
- 无墙门框、无天花板吊灯
- 多组窗帘、漂浮家具和额外漂浮建筑
- 异常月亮、倒挂草地、天空楼梯和静止鸟群

### 4. 滚动中的出现节奏

| 阶段 | 场景异常 | 控制原则 |
| --- | --- | --- |
| Hero / About | 远处可见漂浮屋子；窗帘不可辨认或只露出极淡下缘 | 第一眼仍像真实草地，随后才发现建筑没有落地 |
| Experience | 屋子略微靠近；云层里开始出现窗帘轮廓 | 不完整展示窗帘，不增加其他异常 |
| Projects | 屋子更清晰；窗帘两片可被辨认，但仍收在画面两侧 | Desk、Carousel、Newsstand 仍是章节主角 |
| Contact | 窗帘缓慢分开，屋子入口成为视觉终点 | 为进入 Explore 做空间转场 |
| Enter Explore | 镜头穿过窗帘并靠近入口 | 窗帘只在此时短暂经过中央内容区 |

### 5. 新增资产

```text
floating-explore-building.webp
floating-explore-building-shadow.webp
cloud-curtain-left.webp
cloud-curtain-right.webp
cloud-curtain-occlusion.webp
```

- `floating-explore-building.webp`：透明背景，完整建筑主体，不烘焙天空、草地、颗粒、光晕或地面阴影。
- `floating-explore-building-shadow.webp`：独立软阴影，可按滚动位置调整透明度和形状。
- `cloud-curtain-left.webp`、`cloud-curtain-right.webp`：两片独立透明薄纱，边缘保留自然半透明度，便于做分开与轻微摆动。
- `cloud-curtain-occlusion.webp`：只包含遮住窗帘上缘的柔云，用于隐藏悬挂起点；如基础云层能自然完成遮挡，可省略。

### 6. World Master 提示词补充

```text
A bright, quiet outdoor meadow with a restrained dreamcore spatial anomaly.
In the far distance, the recognizable Explore house floats gently above the
grass, with a clear band of open air beneath the building. It remains an
ordinary believable house in shape and material; only gravity is wrong.
One pair of pale cream, semi-transparent indoor curtains descends from within
the clouds. Their upper attachment is completely hidden by soft cloud, and
their lower edges stop in mid-air without touching the meadow. The curtains
are subtle and mostly kept near the outer sides of the composition, leaving
the central content-safe area clear. Bright natural daylight, calm Japanese
live-action film atmosphere, clean continuous color, no horror, no fantasy
spectacle, no goldfish, no water caustics, no ground anomalies, no baked film
grain, no dust spots, no VHS effects, no excessive texture.
```

<!-- DREAMCORE-DIRECTION-END -->
