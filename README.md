# 深圳二手房成交查询（静态站，可直接发布到 GitHub Pages）

零依赖单页应用：无框架、无构建步骤、无后端，只有一个 HTML + 两个 JS + 一个 JSON 数据文件。
首次加载约 1MB（gzip 后约 300KB），13,460 条记录的筛选/排序/聚合都是毫秒级内存运算。

## 功能

- **多维筛选**：关键词（小区/片区/区）、片区多选、成交日期区间、面积/总价/单价区间、建成年份区间、谈价率区间、行政区多选、房数、来源、朝向（按方位位掩码，组合朝向如「南/北」会同时命中「南」和「北」）、去重口径
- **快速预设**：近 1/3/6 个月、南山周报、砍价 ≥10%、捡漏（砍价≥15% 且 ≤1000万）、刚需 60–90㎡、小户型 ≤60㎡
- **结果概览**：条数、中位/均价单价、中位面积、中位总价、价格与日期范围、来源构成
- **走势缩略图**：按统计期的中位单价曲线（混选多源时会提示口径风险）
- **排序**：任意列升/降序；**导出 CSV**（含出处）；**复制筛选链接**（筛选状态写进 URL hash，可直接分享）
- **可追溯**：每行可点「原笔记」跳回小红书原文；重复合并/疑似重复都有标记
- 响应式，手机可用；筛选面板在窄屏自动堆叠

## 本地预览

```bash
cd web && python3 -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

> 不能直接双击 `index.html`：ES 模块与 `fetch` 需要 http 协议。

## 发布到 GitHub Pages

`web/` 是自包含的站点根目录，只包含站点文件（数据快照约 1MB），**不包含** 数据集原图（300MB+）。

### 方式 A：新建独立仓库（推荐）

```bash
# 1) 在 GitHub 上新建一个空仓库，例如 shenzhen-deals
bash tools/publish_web.sh git@github.com:<你的用户名>/shenzhen-deals.git

# 2) 打开仓库 Settings → Pages
#    Source: Deploy from a branch
#    Branch: main  /  (root)      → 保存
# 3) 一分钟后访问：
#    https://<你的用户名>.github.io/shenzhen-deals/
```

### 方式 B：放进现有仓库的 docs/ 子目录

把 `web/` 整个目录内容复制到目标仓库的 `docs/`，然后在 Settings → Pages 里选 `main / docs`。

> 站点已含 `.nojekyll`，不会触发 Jekyll 处理。

## 数据格式（`data/deals.json`）

字典编码 + 行数组，把 13,460 行压到约 1MB：

```
dict.district / area_group / community / layout / facing / source  →  取值字典
dict.period      → [{label, key, start, end}]，period_order 为按时间排序的下标
dict.note        → [{url, title, author, source}]，用于「原笔记」链接
dict.facing_mask → 与 dict.facing 平行的方位位掩码（东1 南2 西4 北8 东南16 西南32 东北64 西北128，0=未标注）
dict.dup_conf    → [null, "high", "medium"]
rows[i]          → 字段顺序见顶层 columns 数组（与 core.js 的 C 常量一致）
```

数据由 `tools/xhs_pipeline/build_web.py` 从 `dataset/transactions.jsonl` 生成。

## 更新数据

```bash
python3 tools/xhs_pipeline/build_dataset.py   # 重建数据集（含清洗、去重判定）
python3 tools/xhs_pipeline/build_web.py       # 重新编译站点数据
python3 tools/xhs_pipeline/web_expect.py && node tools/xhs_pipeline/test_web.mjs   # 数据层对账
python3 tools/xhs_pipeline/e2e_web.py         # 浏览器端到端测试（需本地服务已启动）
```

## 代码结构

| 文件 | 职责 |
|---|---|
| `index.html` | 结构 + 样式（单文件 CSS，无外部依赖） |
| `core.js` | **纯逻辑**：筛选、排序、聚合、走势、CSV 生成；不碰 DOM，可直接在 Node 里测试 |
| `app.js` | DOM 绑定与渲染（筛选控件、表格、走势 SVG、URL 状态、导出） |
| `data/deals.json` | 数据快照 |
| `package.json` | 仅声明 `"type": "module"`，便于 Node 里 import `core.js` |
