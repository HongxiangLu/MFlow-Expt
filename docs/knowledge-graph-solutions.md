# 知识库图谱技术方案对比

本文基于 `docs/book.md` 与 `docs/mock-obsd.md` 的需求整理，目标是在三栏知识库页面中实现类似 Obsidian 的知识图谱体验：

- 左侧：知识库 / 当前书本章节
- 中间：AI 对话 / 书本原文 Markdown
- 右侧：当前知识库全局关系图，可缩放、拖拽、点击、悬浮查看关系

核心目标优先级：

1. 性能稳定
2. 用户体验流畅
3. 后期可扩展
4. mock 接口和数据尽量贴近真实业务

---

## 方案一：Sigma.js + Graphology + ForceAtlas2

### 定位

推荐主方案，适合正式知识库产品。

该方案优先考虑大规模图谱性能、复杂图数据管理和后续扩展能力。当前项目已经引入并使用了：

- `sigma`
- `graphology`
- `graphology-layout-forceatlas2`

因此该方案与现有代码基础最匹配。

### 技术组成

```txt
graphology：管理图数据结构
graphology-layout-forceatlas2：计算图谱布局
sigma.js：WebGL 渲染图谱
zustand：管理图谱状态
react-markdown：渲染中间 Markdown 原文
```

### 适用场景

```txt
节点数量：几百到上万
关系复杂度：中高
性能要求：高
用户体验：需要缩放、拖拽、悬浮高亮、点击聚焦、小地图、节点过滤
后期扩展：强
```

### 核心实现流程

```txt
1. 后端 / mock 返回 GraphResponse
2. 前端用 graphology 构建图结构
3. 使用 ForceAtlas2 计算节点布局
4. 使用 sigma.js WebGL 渲染图谱
5. hover 节点时，通过 nodeReducer / edgeReducer 高亮相关节点
6. click 节点时，相机平滑聚焦到节点
7. click Markdown 链接时，右侧图谱定位对应节点
8. click 左侧章节时，中间切换章节，右侧图谱聚焦章节相关子图
```

### 推荐数据结构

```ts
type GraphResponse = {
  graphId: string
  centerNodeId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

type GraphNode = {
  id: string
  label: string
  nodeType:
    | 'knowledge_base'
    | 'book'
    | 'chapter'
    | 'section'
    | 'markdown_note'
    | 'artifact'
    | 'person'
    | 'dynasty'
    | 'site'
    | 'concept'
    | 'material'
    | 'pattern'
    | 'craft'
    | 'other'
}

type GraphEdge = {
  id: string
  source: string
  target: string
  label: string
  weight?: number
}
```

### 性能策略

```txt
默认只显示核心节点、章节节点、主要实体节点
大规模节点按需展开
ForceAtlas2 布局结果缓存
切换章节不重建图，只更新高亮和相机位置
默认隐藏大部分边标签
hover / selected / zoom 到一定级别后再显示标签
大图布局可迁移到 Web Worker
```

### 用户体验策略

```txt
hover 节点：当前节点和一跳关系高亮，无关节点变灰
click 节点：图谱聚焦，同时中间区域定位到相关原文
click Markdown 链接：右侧图谱聚焦对应节点
click 左侧章节：中间切换章节，右侧聚焦章节子图
保留用户图谱缩放和拖拽状态
提供搜索、节点类型过滤、重置视图
```

### 优点

```txt
性能最好，适合大图
WebGL 渲染流畅
graphology 适合复杂图数据管理
后续做过滤、搜索、子图展开、小地图都更稳
当前项目已经引入这些依赖，迁移成本最低
```

### 缺点

```txt
开发复杂度高于封装型图库
ForceAtlas2 参数需要调试
图谱交互细节需要自己组织状态
```

### 结论

```txt
这是最推荐方案。
适合真实知识库产品，不只是 demo。
```

---

## 方案二：D3 Force + Canvas

### 定位

备选方案，适合自研程度更高、视觉和交互高度定制的场景。

该方案更接近 Obsidian 图谱底层原理，需要自己维护布局、渲染、命中检测、拖拽、缩放、高亮等能力。

### 技术组成

```txt
d3-force：力导向布局
Canvas 2D：渲染节点和边
React：管理页面结构和状态
zustand：管理图谱、选中节点、hover 节点
react-markdown：渲染中间 Markdown 原文
```

### 适用场景

```txt
节点数量：几十到几千
关系复杂度：中等
性能要求：中高
用户体验：需要高度自定义图谱样式
后期扩展：中等
```

### 核心实现流程

```txt
1. 后端 / mock 返回 nodes 和 edges
2. 使用 d3-force 创建 simulation
3. 每个 tick 更新节点 x / y
4. Canvas 每帧清空并重绘边、节点、标签
5. 自己维护 viewport transform：x、y、scale
6. 自己实现拖拽背景、缩放、节点拖拽
7. 自己做 hit test 判断鼠标悬浮节点
8. 根据 adjacency 邻接表实现无关节点变灰
```

### 推荐数据结构

```ts
type CanvasGraphNode = {
  id: string
  label: string
  nodeType: string
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  radius?: number
}

type CanvasGraphEdge = {
  id: string
  source: string | CanvasGraphNode
  target: string | CanvasGraphNode
  label: string
  weight?: number
}
```

### 推荐模块拆分

```txt
graph-parser.ts：把 Markdown 链接或接口数据转成 nodes / edges
graph-layout.ts：封装 d3-force simulation
graph-renderer.ts：封装 Canvas 绘制逻辑
graph-interaction.ts：处理 hover、click、drag、zoom
graph-store.ts：存 selectedNodeId、hoveredNodeId、transform
```

### 性能策略

```txt
Canvas 渲染，不使用 SVG DOM
使用 requestAnimationFrame 控制重绘
节点少时直接遍历 hit test
节点多时使用 quadtree 或 grid spatial index
标签分级显示，缩放小时隐藏标签
拖拽和缩放时降低边标签绘制频率
布局稳定后降低 simulation alpha 或停止 simulation
```

### 用户体验策略

```txt
hover 节点：通过 adjacency 高亮一跳关系
click 节点：固定选中状态，并联动中间 Markdown
drag 背景：修改 viewport transform
drag 节点：修改 node.fx / node.fy
wheel 缩放：围绕鼠标位置缩放
双击节点：展开子关系
搜索节点：定位并闪烁高亮
```

### 优点

```txt
视觉和交互完全可控
实现逻辑直观，适合理解 Obsidian 图谱底层
不依赖 sigma 的渲染规则
可以做非常定制化的节点、边、标签效果
```

### 缺点

```txt
需要自己实现大量基础能力
命中检测、缩放、拖拽、标签避让都要手写
大规模图性能不如 sigma.js WebGL
复杂图管理不如 graphology
后期维护成本更高
```

### 结论

```txt
适合中等规模图谱或强定制场景。
如果目标是快速做出稳定产品，不如 Sigma 方案稳。
```

---

## 两套方案对比

| 维度 | Sigma.js + Graphology + ForceAtlas2 | D3 Force + Canvas |
|---|---|---|
| 推荐程度 | 高 | 中 |
| 渲染方式 | WebGL | Canvas 2D |
| 图数据管理 | 强，graphology 原生支持 | 需要自建 |
| 大图性能 | 更好 | 中等 |
| 自定义自由度 | 中高 | 最高 |
| 开发成本 | 中等 | 高 |
| 维护成本 | 中等 | 高 |
| Obsidian 类交互 | 适合 | 适合，但需手写更多逻辑 |
| 小地图 / 过滤 / 搜索 | 更容易扩展 | 需要自行实现 |
| 当前项目适配度 | 最高 | 一般 |

---

## 最终建议

如果目标是正式知识库产品，并且优先考虑性能和用户体验，建议选择：

```txt
Sigma.js + Graphology + ForceAtlas2
```

推荐采用以下产品策略：

```txt
总览 + 聚焦子图 + 按需展开
```

也就是：

1. 默认展示当前知识库总览。
2. 用户点击左侧章节、中间 Markdown 链接或图谱节点时，只更新聚焦和高亮状态。
3. 大规模图谱不一次性展示所有细节，节点和边按需展开。
4. 布局结果缓存，避免频繁重算。
5. 标签和边标签分级显示，保证图谱流畅。

D3 Force + Canvas 更适合作为备选方案，或后续需要完全自研图谱引擎时参考。
