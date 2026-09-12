# public/works

存放策划案相关的原始物料（完整 deck PDF 等）。

## guanxia-summer.pdf —— 观夏 · 夏季营销 deck（58 MB）

> ⚠️ **这个文件目前没有进 git 仓库**，但**本地是完整的**。

它的体积为 58,509,599 字节（≈55.8 MiB），超过了 GitHub **REST API** 的实际上限：
无论 `POST /git/blobs`（Git Data API）还是 `PUT /repos/.../contents/...`（Contents API），
都会返回 `422 Sorry, the file is too large to be processed`。
而本项目的推送走的是 API（`github.com` 的 git 传输在本环境不可达），所以它暂时留在本地。

**它在站点里的作用**（见 `src/data/works.ts` 中 PLAN_01 的 `pdf` 字段）：

1. 「下载完整 PDF」入口；
2. 运行时用 pdf.js 渲染 deck 首页作为案例高光图。

因此在新环境 clone 后，若缺少这个文件，观夏案例的**高光图会空、下载链接会 404**——
需要按下面任一方式补回来。

### 方式一：用普通 git 传输推上去（推荐）

在**能连通 `github.com` git 传输**的机器上（58 MB 未超过 git 单文件 100 MB 上限）：

```bash
git add -f public/works/guanxia-summer.pdf
git commit -m "chore: 补传观夏 deck"
git push origin main
```

### 方式二：改用 Git LFS

```bash
git lfs install
git lfs track "public/works/*.pdf"
git add .gitattributes public/works/guanxia-summer.pdf
git commit -m "chore: 用 LFS 跟踪策划案 deck"
git push origin main
```

### 方式三：压缩后再传

把 deck 压到 ~30 MB 以下即可通过 REST API 推送。压完记得同步更新本文件说明。

---

注：`.gitignore` 已忽略本目录的 `*.pdf`，以免后续 `git add -A` 又把推不上去的文件带进索引
（真要入库时用 `git add -f` 强制添加即可）。
