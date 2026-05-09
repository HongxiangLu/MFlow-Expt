# Obsidian 里的知识图谱底层是如何实现的？

## 问题

Obsidian 里的知识图谱底层是如何实现的？  
包括：

- 图谱节点和连线是怎么生成的？
- 拖拽是怎么实现的？
- 鼠标浮到某个节点上时，为什么无关节点会变灰？
- 如果自己用前端技术实现类似效果，应该怎么做？

---

## 核心理解

Obsidian 的知识图谱，本质上可以理解为：

> Markdown 文件链接关系数据 + 图数据结构 + 力导向图布局 + Canvas / SVG / WebGL 渲染 + 鼠标交互状态控制

也就是说，它并不是一个特殊的神秘功能，而是一个典型的 **Graph View / Force-directed Graph**。

在 Obsidian 中：

- 每一篇 Markdown 笔记可以看作一个节点；
- 每一个 `[[内部链接]]` 可以看作一条边；
- 多篇笔记之间的引用关系最终会形成一个图结构；
- 图谱通过力导向算法自动布局；
- 通过鼠标事件实现拖拽、缩放、悬浮高亮等交互。

---

## 1. 数据层：把 Markdown 链接转成图结构

Obsidian 的知识图谱首先需要从文件中提取关系。

假设有这些笔记：

```text
唐代瓷器.md
青花瓷.md
宋代陶瓷.md
```

如果 `唐代瓷器.md` 中写了：

```md
[[青花瓷]]
[[宋代陶瓷]]
```

那么就可以认为：

```text
唐代瓷器 -> 青花瓷
唐代瓷器 -> 宋代陶瓷
```

也就是：

```js
const nodes = [
  { id: "唐代瓷器.md", title: "唐代瓷器" },
  { id: "青花瓷.md", title: "青花瓷" },
  { id: "宋代陶瓷.md", title: "宋代陶瓷" }
];

const links = [
  { source: "唐代瓷器.md", target: "青花瓷.md" },
  { source: "唐代瓷器.md", target: "宋代陶瓷.md" }
];
```

这里的 `nodes` 表示节点，`links` 表示节点之间的关系。

---

## 2. 邻接表：快速判断节点关系

为了实现“鼠标浮上去时，只高亮相关节点”，通常会建立一个邻接表。

邻接表的作用是：

> 快速查询某个节点和哪些节点直接相连。

例如：

```js
const adjacency = new Map();

for (const node of nodes) {
  adjacency.set(node.id, new Set());
}

for (const link of links) {
  adjacency.get(link.source).add(link.target);
  adjacency.get(link.target).add(link.source);
}
```

如果图结构是：

```text
A -- B
A -- C
B -- D
```

那么邻接表大概是：

```js
A: B, C
B: A, D
C: A
D: B
```

当鼠标悬浮到 `A` 时，就可以立刻知道：

```text
A 的相关节点是 B 和 C
```

然后让 `A`、`B`、`C` 正常显示，让其他节点变灰。

---

## 3. 布局层：力导向图 Force-directed Graph

Obsidian 的知识图谱不是固定坐标布局，而是类似一个物理系统。

可以理解为：

```text
节点 = 小球
边 = 弹簧
节点之间 = 互相排斥
整体 = 被拉向中心
```

常见力导向图会包含几种力：

| 力 | 作用 |
|---|---|
| Center force | 把图整体拉向画布中心 |
| Repel force | 节点之间互相排斥，避免重叠 |
| Link force | 有关系的节点像弹簧一样被拉住 |
| Link distance | 控制相连节点之间的理想距离 |

如果用 `d3-force`，代码大概是：

```js
const simulation = d3.forceSimulation(nodes)
  .force(
    "link",
    d3.forceLink(links)
      .id(d => d.id)
      .distance(80)
      .strength(0.6)
  )
  .force("charge", d3.forceManyBody().strength(-120))
  .force("center", d3.forceCenter(width / 2, height / 2));
```

其中：

```text
forceLink     控制连线节点之间的弹簧关系
forceManyBody 控制节点之间的排斥力
forceCenter   控制图谱整体居中
```

力导向图会不断计算每个节点的位置：

```js
node.x
node.y
node.vx
node.vy
```

然后渲染层根据这些坐标把节点画出来。

---

## 4. 渲染层：Canvas / SVG / WebGL

知识图谱最终要显示到页面上，常见渲染方式有三种：

| 渲染方式 | 特点 |
|---|---|
| SVG | 交互简单，适合少量节点 |
| Canvas | 性能较好，适合几百到几千个节点 |
| WebGL | 性能最好，适合大规模图谱 |

如果节点很少，可以用 SVG：

```html
<svg>
  <line />
  <circle />
  <text />
</svg>
```

但如果节点很多，使用大量 SVG DOM 会变卡。  
因此类似 Obsidian 这种图谱，更适合使用 Canvas 或 WebGL。

Canvas 渲染逻辑大概是：

```js
function render() {
  ctx.clearRect(0, 0, width, height);

  drawLinks();
  drawNodes();
  drawLabels();

  requestAnimationFrame(render);
}
```

每一帧都根据当前节点位置重新绘制：

```js
function drawLinks() {
  for (const link of links) {
    ctx.beginPath();
    ctx.moveTo(link.source.x, link.source.y);
    ctx.lineTo(link.target.x, link.target.y);
    ctx.stroke();
  }
}

function drawNodes() {
  for (const node of nodes) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

---

## 5. 拖拽背景：移动整个图谱视口

Obsidian 中拖拽空白区域时，图谱整体会移动。

这个不是改变每个节点的真实坐标，而是改变视口偏移量。

通常会维护一个 `transform`：

```js
let transform = {
  x: 0,
  y: 0,
  scale: 1
};
```

其中：

```text
x     表示画布水平偏移
y     表示画布垂直偏移
scale 表示缩放比例
```

当用户按住空白区域拖动时：

```js
transform.x += dx;
transform.y += dy;
```

渲染时，把图坐标转换成屏幕坐标：

```js
screenX = node.x * transform.scale + transform.x;
screenY = node.y * transform.scale + transform.y;
```

所以拖拽背景的本质是：

> 节点自身坐标不变，只是整个视口发生了平移。

可以理解成移动摄像机，而不是移动物体。

---

## 6. 拖拽节点：修改节点固定坐标

拖拽某个节点时，逻辑和拖拽背景不同。

拖拽节点时，需要让这个节点跟随鼠标移动。

在力导向图中，节点通常有这些属性：

```js
{
  x: 100,
  y: 80,
  vx: 0,
  vy: 0,
  fx: null,
  fy: null
}
```

含义是：

| 属性 | 含义 |
|---|---|
| `x` | 节点当前 x 坐标 |
| `y` | 节点当前 y 坐标 |
| `vx` | 节点 x 方向速度 |
| `vy` | 节点 y 方向速度 |
| `fx` | 节点固定 x 坐标 |
| `fy` | 节点固定 y 坐标 |

拖拽节点时，可以设置：

```js
node.fx = mouseX;
node.fy = mouseY;
```

这样节点就会被固定到鼠标所在的位置。

拖拽逻辑大概是：

```js
function onDragStart(node) {
  simulation.alphaTarget(0.3).restart();

  node.fx = node.x;
  node.fy = node.y;
}

function onDrag(node, mouse) {
  node.fx = mouse.graphX;
  node.fy = mouse.graphY;
}

function onDragEnd(node) {
  simulation.alphaTarget(0);

  node.fx = null;
  node.fy = null;
}
```

这里需要注意：

如果松手后执行：

```js
node.fx = null;
node.fy = null;
```

节点会重新参与力导向模拟。

如果松手后不清空 `fx` 和 `fy`，节点会被固定在当前位置。

所以节点拖拽的本质是：

> 鼠标移动时，不断更新节点的 `fx` 和 `fy`。

---

## 7. 缩放图谱：修改 scale

图谱缩放通常通过鼠标滚轮实现。

缩放的核心仍然是修改 `transform`：

```js
let transform = {
  x: 0,
  y: 0,
  scale: 1
};
```

滚轮事件：

```js
canvas.addEventListener("wheel", event => {
  const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;

  transform.scale *= zoomFactor;
});
```

渲染时：

```js
screenX = node.x * transform.scale + transform.x;
screenY = node.y * transform.scale + transform.y;
```

所以缩放的本质是：

> 修改图坐标到屏幕坐标之间的转换比例。

如果想让缩放围绕鼠标所在位置进行，还需要根据鼠标位置修正 `transform.x` 和 `transform.y`。

---

## 8. 鼠标悬浮：无关节点变灰

这是 Obsidian 知识图谱里很重要的交互效果。

当鼠标浮到某个节点时：

```text
当前节点：高亮
直接相连节点：正常显示
直接相连边：正常显示
无关节点：变灰 / 降低透明度
无关边：变淡 / 隐藏
```

这个功能的核心不是重新布局，而是根据邻接表改变渲染样式。

假设鼠标悬浮到了节点 `A.md`：

```js
let hoveredNodeId = "A.md";
```

先找出相关节点：

```js
const related = new Set([
  hoveredNodeId,
  ...adjacency.get(hoveredNodeId)
]);
```

然后渲染节点时判断：

```js
function getNodeOpacity(node) {
  if (!hoveredNodeId) return 1;

  return related.has(node.id) ? 1 : 0.15;
}
```

渲染边时判断：

```js
function getLinkOpacity(link) {
  if (!hoveredNodeId) return 0.6;

  const sourceId = link.source.id ?? link.source;
  const targetId = link.target.id ?? link.target;

  const isRelated =
    sourceId === hoveredNodeId ||
    targetId === hoveredNodeId;

  return isRelated ? 1 : 0.05;
}
```

最终效果就是：

```text
和当前节点有关的内容正常显示；
和当前节点无关的内容降低透明度。
```

所以“鼠标浮上去无用节点变灰”的本质是：

> 记录当前 hover 的节点，然后根据图的邻接关系动态调整节点和边的透明度 / 颜色。

---

## 9. 鼠标如何知道悬浮到了哪个节点？

这取决于渲染方式。

如果使用 SVG，每个节点都是独立 DOM 元素，可以直接绑定事件：

```js
circle.onmouseenter = () => {
  hoveredNodeId = node.id;
};

circle.onmouseleave = () => {
  hoveredNodeId = null;
};
```

但如果使用 Canvas，所有节点都画在同一个画布上。  
Canvas 里没有单独的节点 DOM，所以需要自己做命中检测。

简单命中检测：

```js
function findNodeAt(mouseX, mouseY) {
  for (const node of nodes) {
    const dx = mouseX - node.x;
    const dy = mouseY - node.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < node.radius) {
      return node;
    }
  }

  return null;
}
```

鼠标移动时：

```js
canvas.addEventListener("mousemove", event => {
  const mouse = getMousePosition(event);
  const node = findNodeAt(mouse.x, mouse.y);

  hoveredNodeId = node ? node.id : null;
});
```

不过如果节点很多，每次鼠标移动都遍历所有节点会影响性能。

常见优化方式有：

```text
Quadtree 四叉树
Grid spatial index 网格空间索引
simulation.find()
```

这些方法可以快速找到鼠标附近的节点，而不是每次都全量遍历。

---

## 10. 整体执行流程

Obsidian 知识图谱整体可以理解为下面这个流程：

```text
1. 扫描 vault 中的 Markdown 文件
2. 解析每个文件里的 [[内部链接]]
3. 把 Markdown 文件转换成 nodes
4. 把内部链接转换成 links
5. 建立 adjacency 邻接表
6. 使用 force simulation 计算节点布局
7. 使用 Canvas / SVG / WebGL 绘制节点和边
8. 鼠标移动时做 hit test，判断当前悬浮节点
9. 根据 adjacency 判断哪些节点相关
10. 相关节点正常显示，无关节点降低透明度
11. 拖拽节点时更新 node.fx / node.fy
12. 拖拽背景时更新 viewport transform
13. 滚轮缩放时更新 transform.scale
```

---

## 11. 如果用 React 自己实现

如果自己用 React 实现一个类似 Obsidian 的知识图谱，可以有几种选择。

### 方案一：D3 Force + Canvas

适合想理解底层、需要高度自定义的场景。

```bash
npm install d3-force d3-drag d3-zoom
```

适合：

```text
几十到几百个节点
需要自己控制交互
需要自定义节点样式
需要理解底层实现
```

### 方案二：react-force-graph

适合快速做出效果。

```bash
npm install react-force-graph
```

它已经封装了很多能力：

```text
节点绘制
连线绘制
拖拽
缩放
悬浮
Canvas / WebGL 渲染
2D / 3D 图谱
```

### 方案三：sigma.js + graphology

适合大规模图谱。

```bash
npm install sigma graphology
```

适合：

```text
几千到上万个节点
需要 WebGL 渲染
需要更好的性能
需要复杂图结构管理
```

---

## 12. 技术选型建议

| 场景 | 推荐方案 |
|---|---|
| 几十到几百节点 | SVG + d3-force |
| 几百到几千节点 | Canvas + d3-force |
| 上万个节点 | WebGL + sigma.js |
| 快速做出 Obsidian 类似效果 | react-force-graph |
| 需要复杂图数据管理 | graphology |
| 需要高性能知识图谱探索 | sigma.js |

---

## 13. 核心总结

Obsidian 知识图谱的底层逻辑可以概括为：

```text
图数据结构 + 力导向布局 + 高性能渲染 + 鼠标交互状态
```

其中：

```text
节点 = Markdown 文件
边 = Markdown 内部链接
布局 = 力导向图算法
渲染 = Canvas / SVG / WebGL
拖拽背景 = 修改 viewport transform
拖拽节点 = 修改 node.fx / node.fy
缩放 = 修改 transform.scale
悬浮变灰 = 根据 adjacency 判断关联节点，再调整 opacity / color
```

最终可以归纳成一句话：

> Obsidian 的知识图谱并不是简单地把文件画成点，而是先把 Markdown 文件和内部链接转换成图数据结构，再通过力导向算法计算布局，最后用 Canvas / SVG / WebGL 渲染，并通过鼠标事件控制拖拽、缩放、悬浮高亮和无关节点变灰等交互。