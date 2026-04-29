# Graph 图后端返回数据格式

本文档用于约定 dashboard 页面中知识图谱 graph 的后端返回数据格式。

## 数据结构

后端建议返回一个完整的 graph 对象：

```ts
type GraphResponse = {
  graphId: string
  centerNodeId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}
```

## 顶层字段

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `graphId` | `string` | 是 | 当前图谱的唯一 ID，一般对应一次查询结果或一个中心文物 |
| `centerNodeId` | `string` | 是 | 中心节点 ID，通常是用户搜索的文物节点 |
| `nodes` | `GraphNode[]` | 是 | 图谱中的所有节点 |
| `edges` | `GraphEdge[]` | 是 | 图谱中的所有关系线 |

## nodes 节点字段

```ts
type GraphNode = {
  id: string
  label: string
  nodeType: string
}
```

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `id` | `string` | 是 | 节点唯一 ID，不能重复；关系线通过该 ID 连接节点 |
| `label` | `string` | 是 | 节点展示名称，前端图上显示的文字 |
| `nodeType` | `string` | 是 | 节点业务类型，用来区分文物、朝代、材质、纹饰等 |

### nodeType 推荐值

| 值 | 含义 | 示例 |
|---|---|---|
| `artifact` | 具体文物 | 司母戊鼎 |
| `dynasty` | 朝代 / 年代 / 历史时期 | 商代 |
| `material` | 材质 | 青铜 |
| `category` | 文物类别 / 器物类型 | 鼎 |
| `pattern` | 纹饰 / 图案 | 兽面纹 |
| `site` | 遗址 / 出土地 / 地域 | 殷墟 |
| `craft` | 工艺 / 制作技术 | 范铸法 |
| `inscription` | 铭文 / 题记 / 文字证据 | 铭文 |
| `usage` | 用途 / 功能 / 使用场景 | 祭祀 |
| `concept` | 文化概念 / 制度 / 象征含义 | 礼制 |
| `person` | 人物 / 墓主 / 作者 / 族属 | 妇好 |
| `collection` | 馆藏 / 展厅 / 机构 / 来源集合 | 青铜器展厅 |

注意：`nodeType` 是业务字段，不要直接使用 `type`。Sigma 官方的 `type` 是渲染类型，当前节点渲染类型通常应由前端内部固定为 `circle`。

## edges 关系字段

```ts
type GraphEdge = {
  id: string
  source: string
  target: string
  label: string
  weight?: number
}
```

| 字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `id` | `string` | 是 | 关系唯一 ID，不能重复 |
| `source` | `string` | 是 | 起点节点 ID，必须对应 `nodes` 中存在的某个 `id` |
| `target` | `string` | 是 | 终点节点 ID，必须对应 `nodes` 中存在的某个 `id` |
| `label` | `string` | 是 | 关系名称，前端显示在线上的文字 |
| `weight` | `number` | 否 | 关系权重，表示关系强弱；前端可用于控制线条粗细或布局影响 |

`weight` 建议范围为 `0.1` 到 `2`。如果后端不返回，前端可以使用默认值 `1`。

## 示例数据

```ts
const mockGraphData = {
  graphId: 'simuwu-ding',
  centerNodeId: 'simuwu-ding',
  nodes: [
    { id: 'simuwu-ding', label: '司母戊鼎', nodeType: 'artifact' },
    { id: 'shang', label: '商代', nodeType: 'dynasty' },
    { id: 'bronze', label: '青铜', nodeType: 'material' },
    { id: 'ding', label: '鼎', nodeType: 'category' },
    { id: 'taotie-pattern', label: '兽面纹', nodeType: 'pattern' },
    { id: 'yinxu', label: '殷墟', nodeType: 'site' }
  ],
  edges: [
    { id: 'e1', source: 'simuwu-ding', target: 'shang', label: '所属年代', weight: 1.2 },
    { id: 'e2', source: 'simuwu-ding', target: 'bronze', label: '主要材质', weight: 1.3 },
    { id: 'e3', source: 'simuwu-ding', target: 'ding', label: '器物类型', weight: 1.4 },
    { id: 'e4', source: 'simuwu-ding', target: 'taotie-pattern', label: '包含纹饰', weight: 1 },
    { id: 'e5', source: 'simuwu-ding', target: 'yinxu', label: '出土地点', weight: 0.9 }
  ]
}
```

## 关系含义示例

```ts
{ source: 'simuwu-ding', target: 'shang', label: '所属年代' }
```

表示：

```txt
司母戊鼎 -> 所属年代 -> 商代
```

## 后端校验规则

- `nodes[].id` 必须唯一。
- `edges[].id` 必须唯一。
- `centerNodeId` 必须能在 `nodes[].id` 中找到。
- `edges[].source` 必须能在 `nodes[].id` 中找到。
- `edges[].target` 必须能在 `nodes[].id` 中找到。
- `label` 建议直接返回中文展示文案，前端会直接渲染。
- 后端不需要返回 `x` / `y` 坐标，前端会自动布局。
