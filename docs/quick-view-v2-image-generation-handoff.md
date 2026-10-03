# Quick View Version 2 生图项目交接文档

> 这份文档用于交给 ChatGPT 生图对话。目标是重新对齐项目背景、现有资产、Explore 物件参考和待生成资产，避免在新对话中重新猜测。

## 1. 项目目标

这个作品集有两种浏览模式：

- **Quick View**：快速、线性地浏览 About、Experience、Works、Contact。
- **Explore**：进入室内工作室，自由探索 CRT、旋转木马、报刊亭等物件。

Version 2 的空间关系已经确定：

```text
Quick View = Explore 建筑外面的草地世界
Explore    = 进入建筑后的室内工作室
```

Quick View 不再使用连续变化的室内背景，而是在同一片草地上向 Explore 建筑前进。Explore 中的重要物件会以“室外版本”出现在 Quick View 中，建立内外呼应。

视觉方向：

> 阴天傍晚的日式独立电影实拍质感，低饱和草地，潮湿空气，柔和胶片颗粒，安静、熟悉但略显异常。材质必须接近真实摄影，不做卡通插画，不做强烈 Analog Horror，不使用明显 AI 梦境光效。

## 2. 本地项目位置

项目根目录：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home
```

Version 1，现有黑色 Quick View：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\_quickview_preview
```

Version 2，当前草地 Quick View：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\_quickview_v2_meadow_preview
```

公共资产目录：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\public
```

Version 2 当前草地资产：

```text
C:\Users\sunchenxi\WorkBuddy\2026-09-08-21-15-22\dreamcore-loader-home\public\quick-view-v2\meadow
```

本地预览地址：

```text
http://127.0.0.1:4174/?quick=1
```

注意：远程 ChatGPT **无法直接读取上述本机路径或本地网址**。路径用于项目人员定位文件。与 ChatGPT 生图时，必须把本文件列出的参考图、截图或视频帧实际上传到对话。

## 3. 项目结构

```text
dreamcore-loader-home/
├─ src/                              # 当前主站与 Explore 源码
│  ├─ sections/
│  │  └─ StudioSection.tsx           # Explore 室内入口、物件热点和页面切换
│  ├─ components/
│  │  ├─ StudioLensBackground.tsx    # 室内背景视频
│  │  ├─ WorksCarousel.tsx           # Explore 旋转木马界面
│  │  └─ NewsstandScene.tsx          # Explore 报刊亭 3D 场景
│  ├─ data/
│  │  └─ studio.ts                   # 室内四个物件的名称和画面坐标
│  └─ lib/
│     └─ carousel/                   # 旋转木马 3D 场景构建代码
│
├─ public/
│  ├─ studio/
│  │  ├─ studio-loop.mp4             # Explore 室内主画面，最重要的整体参考
│  │  └─ studio-poster.jpg           # 室内静态封面
│  ├─ carousel/                      # 旋转木马结构纹理
│  │  ├─ carousel-base.png
│  │  ├─ carousel-column.png
│  │  └─ carousel-panels.png
│  ├─ newsstand/
│  │  ├─ rack.glb                    # 报刊亭/展架主体模型
│  │  ├─ dvd.glb
│  │  ├─ dv.glb
│  │  ├─ mp3.glb
│  │  └─ tape.glb
│  ├─ quick-view/
│  │  └─ explore-icons/              # 旧 Quick View 的手绘提示图，不是生图造型标准
│  └─ quick-view-v2/
│     └─ meadow/                     # 当前 V2 草地分层资产
│
├─ _quickview_preview/               # Version 1，保留用于对比
└─ _quickview_v2_meadow_preview/     # Version 2 独立实现
   └─ src/
      ├─ components/QuickViewShell.tsx
      └─ meadow-v2.css
```

## 4. Explore 中物件的真实位置

Explore 室内画面的四个热点坐标记录在：

```text
src/data/studio.ts
```

对应位置：

| 物件 | 室内画面位置 | 对应内容 |
|---|---:|---|
| Computer / CRT | x 14.5%，y 46.5% | About Me |
| Notebook | x 61.5%，y 86% | Experience / 实习日记 |
| Carousel | x 53.5%，y 40.5% | Works |
| Newsstand | x 86.5%，y 40% | Creative Lab |

这组坐标说明：

- CRT 和桌子位于室内画面左侧。
- Carousel 位于画面中部。
- Newsstand 位于画面右侧。
- Notebook 不属于本轮草地场景的三个核心大型物件，暂不生图。

## 5. 如何找到和截取 Explore 物件外观

### 5.1 Desk / CRT

Desk / CRT 没有独立 GLB 模型，主要存在于室内背景视频中。

第一参考：

```text
public/studio/studio-loop.mp4
```

第二参考：

```text
public/studio/studio-poster.jpg
```

寻找方法：

1. 打开 `studio-loop.mp4` 或 `studio-poster.jpg`。
2. 查看画面左侧约 14.5% 宽度、垂直约 46.5% 的位置。
3. 截取包含桌子、CRT、桌面物品和周围局部空间的图。
4. 至少准备一张全物件截图和一张 CRT 屏幕细节截图。

也可在主站启动后打开：

```text
http://127.0.0.1:4174/?studio=1
```

然后截取左侧桌子与 CRT。不要只截 CRT 屏幕，必须让 ChatGPT 看到桌腿、桌面厚度和整体比例。

必须保持的识别点：

- CRT 的外壳颜色和屏幕比例。
- 桌子整体轮廓。
- CRT 在桌面上的位置。
- Explore 中已经形成的旧设备、工作台和梦核工作室气质。

允许变化：

- 室外版本可以增加轻微潮湿、灰尘和自然旧化。
- 桌面小物可以适度简化。
- 光线可调整为当前草地世界的阴天环境光。

### 5.2 Carousel

Carousel 是代码生成的 3D 场景，不是单一完整图片。

代码入口：

```text
src/components/WorksCarousel.tsx
src/lib/carousel/carousel-scene.ts
```

结构纹理：

```text
public/carousel/carousel-base.png
public/carousel/carousel-column.png
public/carousel/carousel-panels.png
```

寻找方法：

1. 启动项目。
2. 打开：

```text
http://127.0.0.1:4174/?studio=1&works=1
```

3. 截取完整旋转木马正面或轻微 3/4 视角。
4. 再截取顶部灯带、中心立柱、马匹和底座细节。
5. 将三张 `public/carousel/*.png` 作为补充结构参考上传。

必须保持的识别点：

- 顶棚形状和层级。
- 中心立柱比例。
- 马匹数量感和分布方式。
- 暖黄色灯带。
- Explore 版本的主要配色。

允许变化：

- 室外版本可以更旧、更潮湿。
- 可以增加很轻的草地接触阴影。
- 不得改成大型游乐园旋转木马，也不得生成全新造型。

### 5.3 Newsstand

Newsstand 的主体是 3D 展架模型。

代码入口：

```text
src/components/NewsstandScene.tsx
```

模型文件：

```text
public/newsstand/rack.glb
public/newsstand/dvd.glb
public/newsstand/dv.glb
public/newsstand/mp3.glb
public/newsstand/tape.glb
```

寻找方法：

1. 启动项目。
2. 打开：

```text
http://127.0.0.1:4174/?studio=1&newsstand=1
```

3. 等模型加载完。
4. 截取完整展架正面、轻微 3/4 视角和局部搁板。
5. 让截图包含架体、书刊和设备之间的关系。

必须保持的识别点：

- 展架的整体轮廓。
- 搁板层数和主要结构。
- 旧媒介设备和书刊混合陈列的特征。
- Explore 版本的材料和配色。

允许变化：

- 室外版本可增加轻微风化。
- 书刊封面可以简化，不要求可读文字。
- 不得改成普通便利店报刊亭或带顶棚的小卖部。

### 5.4 Explore Building

Explore 目前没有一个既定的外部建筑模型。现有 V2 建筑图是概念资产，桌面和移动版轮廓不一致。

现有位置：

```text
public/quick-view-v2/meadow/building-desktop-cropped.png
public/quick-view-v2/meadow/building-mobile-cropped.png
```

它们可以作为气质、灯光和建筑类型参考，但正式生图必须统一成同一栋建筑。

建筑需要让人相信当前 Explore 工作室位于其中：旧工业工作室、艺术学校或偏装饰艺术风格的旧建筑，正面入口明确，有圆窗、塔楼、暖色窗灯和少量藤蔓。

## 6. 当前已经有的 V2 资产

目录：

```text
public/quick-view-v2/meadow/
```

| 文件 | 用途 | 是否保留 |
|---|---|---|
| `meadow-desktop.png` | 桌面草地 Clean Plate | 保留 |
| `meadow-mobile.png` | 移动草地 Clean Plate | 保留 |
| `tree-desktop.png` | 桌面左侧近景树 | 保留 |
| `tree-mobile.png` | 移动左侧近景树 | 保留 |
| `grass-desktop.png` | 桌面前景草 | 保留 |
| `grass-mobile.png` | 移动前景草 | 保留 |
| `building-desktop.png` | 带透明空白的旧建筑原图 | 只作参考 |
| `building-mobile.png` | 带透明空白的旧建筑原图 | 只作参考 |
| `building-desktop-cropped.png` | 当前桌面原型建筑 | 临时使用 |
| `building-mobile-cropped.png` | 当前移动原型建筑 | 临时使用 |

现有草地主场景已经锁定：

- 阴天。
- 低饱和绿灰色。
- 中央有向远方延伸的小路。
- 低机位但不是贴地镜头。
- 画面属于写实摄影，不属于插画。

所有新增物件必须适配这套光线、镜头高度和色彩，不能分别生成自己的天空和草地。

## 7. 必须新增的资产清单

### 7.1 建筑正式版

```text
building-far-desktop.webp
building-near-desktop.webp
building-far-mobile.webp
building-near-mobile.webp
building-window-glow.webp
building-ground-shadow.webp
```

要求：

- Far 与 Near 必须是同一栋建筑、同一正面视角和同一轮廓。
- Near 只增加细节，不能更换门窗和塔楼结构。
- 桌面和移动端必须是同一栋建筑的响应式构图。
- 透明背景。
- 建筑真实底边必须贴住图片底边，底部不得残留大块透明空白。
- 不得包含天空、草地、雾、路径或完整环境。

建议尺寸：

| 文件 | 建议尺寸 |
|---|---:|
| building-far-desktop | 1800×1000 |
| building-near-desktop | 2400×1400 |
| building-far-mobile | 1200×1100 |
| building-near-mobile | 1600×1500 |

### 7.2 Desk / CRT

```text
desk-crt-desktop.webp
desk-crt-mobile.webp
crt-screen-glow.webp
desk-ground-shadow.webp
```

要求：

- 根据 Explore 左侧真实 Desk / CRT 截图制作。
- 主体透明背景。
- 桌腿完整，桌脚落在图片底边附近。
- CRT 屏幕保持暗色，不把发光画面烘焙进主体。
- `crt-screen-glow` 只包含屏幕发光区域。
- 阴影单独输出，使用透明背景。
- 主体建议锚点：`transform-origin: 50% 94%`。

建议尺寸：

| 文件 | 建议尺寸 |
|---|---:|
| desk-crt-desktop | 1800×1500 |
| desk-crt-mobile | 1400×1500 |

### 7.3 Carousel

```text
carousel-desktop.webp
carousel-mobile.webp
carousel-glow.webp
carousel-ground-shadow.webp
```

要求：

- 根据 Explore 真实 Carousel 截图和三张结构纹理制作。
- 透明背景。
- 主体不自带大面积光晕。
- `carousel-glow` 单独包含灯带、灯泡和极弱暖光。
- 阴影单独输出。
- 主体建议锚点：`transform-origin: 50% 96%`。

建议尺寸：

| 文件 | 建议尺寸 |
|---|---:|
| carousel-desktop | 2200×1900 |
| carousel-mobile | 1600×1900 |

### 7.4 Newsstand

```text
newsstand-desktop.webp
newsstand-mobile.webp
newsstand-ground-shadow.webp
```

要求：

- 根据 Explore 的 `rack.glb` 实际渲染截图制作。
- 透明背景。
- 保持展架结构，不改造成便利店小卖部。
- 不需要独立 Glow。
- 阴影单独输出。
- 主体建议锚点：`transform-origin: 50% 96%`。

建议尺寸：

| 文件 | 建议尺寸 |
|---|---:|
| newsstand-desktop | 1800×1800 |
| newsstand-mobile | 1500×1800 |

### 7.5 可选辅助资产

```text
low-mist-wide.webp
contact-grass-small-01.webp
contact-grass-small-02.webp
```

其中雾优先使用 CSS。只有 CSS 雾缺乏自然层次时才制作 `low-mist-wide.webp`。

## 8. 不要生成的内容

- 不要为 About、Experience、Works、Contact 分别生成完整背景图。
- 不要把 Desk、Carousel、Newsstand 和草地烘焙成一张合成图。
- 不要把正文、项目标题或履历文字画进图片。
- 不要生成新的天空和地平线。
- 不要让所有物件发光。
- 不要使用强 RGB Glitch、电视雪花和大面积 VHS 故障。
- 不要做成动画电影、二次元、游戏概念图或明显 3D 渲染图。
- 不要依靠雾、颗粒和暗角掩盖透视错误。
- 不要让透明图片底部保留大块空白。

## 9. 滚动中的使用方式

资产必须支持下面的连续场景，而不是静态展示：

```text
Intro
空草地，建筑在远处

About
Desk / CRT 从左侧进入并落在草地上

Experience
Desk 后退；远处先出现 Carousel 暖光，再出现主体轮廓

Works
Carousel 靠近并成为主要场景物件

Contact
Carousel 退远；Newsstand 从右侧出现；建筑明显靠近并亮起窗灯

Ending
其他物件退到外围；建筑正门成为视觉目标；进入 Explore
```

因此每个物件必须：

- 独立透明。
- 有明确地面接触点。
- 能承受约 0.35–1.15 的缩放。
- 不依赖固定背景才能成立。
- 桌面和移动端维持同一造型。

## 10. 页面中保持不变的内容

生图阶段不要重新设计 Quick View 的信息层：

- About：ID Card + 旁边的介绍文字。
- Experience：连线组成的小猫和经历节点。
- Works：现有项目选择和项目封面。
- Contact：联系方式和 `ENTER EXPLORE`。
- About → Experience → Works → Contact 的章节顺序。

当前只先补齐场景资产并查看滚动效果。场景原型完成后，才根据真实遮挡修改内容位置。

## 11. 交给 ChatGPT 时需要实际上传的文件

建议按下列顺序上传，不要一次塞入大量无关文件。

### 第一组：世界基准

必须上传：

```text
meadow-desktop.png
meadow-mobile.png
tree-desktop.png
tree-mobile.png
grass-desktop.png
grass-mobile.png
building-desktop-cropped.png
building-mobile-cropped.png
```

用途：锁定草地、光线、地平线、色调和当前建筑方向。

### 第二组：Explore 物件参考

上传截图：

- Explore 室内完整画面一张。
- Desk / CRT 全物件截图一张。
- CRT 局部截图一张。
- Carousel 完整正面或3/4截图一张。
- Carousel 顶棚和灯带局部一张。
- Newsstand 完整正面或3/4截图一张。
- Newsstand 搁板和设备局部一张。

可补充上传：

```text
studio-poster.jpg
carousel-base.png
carousel-column.png
carousel-panels.png
```

`*.glb` 不一定能被普通 ChatGPT 生图对话直接观察，因此 Newsstand 应优先上传实际渲染截图，而不是只上传 GLB。

## 12. 每轮生图工作方式

一次只制作一个物件，顺序如下：

1. 建筑 Far / Near。
2. Desk / CRT。
3. Carousel。
4. Newsstand。
5. Glow 和地面阴影。
6. 移动端响应式版本。

每轮先确认主体造型，再要求透明背景版本。不要在同一轮同时要求四个物件，否则造型、光线和透视更容易失控。

## 13. 可直接发送给 ChatGPT 的开场说明

```text
我正在为一个作品集网站制作 Quick View Version 2 的分层视觉资产。

这个网站有两个模式：Quick View 是 Explore 建筑外面的草地世界，Explore 是进入建筑后的室内工作室。Quick View 中出现的 Desk / CRT、Carousel 和 Newsstand 必须与我上传的 Explore 截图保持同一造型和识别特征，但改成位于室外草地中的真实摄影版本。

视觉风格是：阴天傍晚的日式独立电影实拍质感，低饱和绿灰色，潮湿空气，柔和胶片色彩，安静、熟悉但略微异常。不要卡通、不要游戏概念图、不要明显 CGI、不要强烈 Analog Horror。

我会先上传现有草地、树、前景草和建筑参考，用来锁定镜头高度、光线、地平线和色调；然后一次只制作一个透明背景物件。所有物件需要独立透明图层，底部必须有明确地面锚点，不能自带天空、草地或完整背景。地面阴影和发光层需要独立输出。

请先阅读资产规范并复述你理解的世界结构、镜头关系、必须保持的造型特征和本轮要输出的文件。不要立即开始生成，等我上传对应的 Explore 参考截图后再制作第一项资产。
```

## 14. 第一轮建议

第一轮先只解决建筑：

- 上传桌面和移动草地主场景。
- 上传当前两张裁剪建筑。
- 要求重新设计为同一栋建筑。
- 先生成桌面 Near 主版本。
- 主版本确认后，再派生 Far 和移动端版本。

不要同时开始 Desk、Carousel 和 Newsstand。先统一建筑，才能固定整个外部世界的建筑语言、灯光和最终入口。
