# knowledge-base/detail 页面实现分析

本文基于业务仓库 `../proofreading-web` 中的代码整理，重点说明 `/knowledge-base/detail/:id` 页面由什么技术实现、左侧目录如何生成、中间 Markdown 如何渲染、接口结构和类型定义。

## 1. 页面定位

详情页路由定义在：

- `../proofreading-web/src/router/routes.tsx`
- 路由：`/knowledge-base/detail/:id`
- 页面组件：`KnowledgeBaseDetail`
- 外层布局：`KnowledgeBaseLayout`

路由结构：

```ts
{
  path: '/knowledge-base/detail/:id',
  element: KnowledgeBaseDetail,
  title: '知识库详情',
}
```

`/knowledge-base` 模块整体挂在 `KnowledgeBaseLayout` 下，布局组件负责渲染顶部 `AppHeader`、面包屑和返回入口，详情页本身主要负责文档详情数据加载和 Markdown 阅读区。

## 2. 主要文件

| 文件 | 作用 |
| --- | --- |
| `src/pages/knowledge-base/knowledge-base-detail.tsx` | 知识库详情页入口组件 |
| `src/pages/knowledge-base/knowledge-base-detail.module.scss` | 详情页外层样式 |
| `src/pages/knowledge-base/hooks/use-kb-markdown.ts` | 根据详情数据加载 Markdown 内容 |
| `src/components/markdown/markdown.tsx` | 通用 Markdown 渲染组件，包含 TOC、代码高亮、公式、锚点、搜索高亮 |
| `src/components/markdown/markdown.module.scss` | Markdown 阅读器和左侧目录样式 |
| `src/stores2/kb-detail-store.ts` | Zustand 详情页状态管理 |
| `src/services2/knowledge-base.ts` | 知识库接口封装 |
| `src/types/knowledge-base.ts` | 知识库接口类型定义 |
| `src/pages/knowledge-base/knowledge-base.utils.ts` | 知识库归属类型归一化和文案转换 |

## 3. 页面用什么做的

该页面是一个 React + TypeScript 页面，构建在现有 Vite 前端工程内。

核心技术和库：

| 能力 | 使用内容 |
| --- | --- |
| 页面框架 | React 19、TypeScript、React Router |
| 样式 | SCSS Modules |
| 状态管理 | Zustand |
| 请求层 | axios 封装的 `request` |
| UI 组件 | `@radix-ui/themes` 的 `Button` |
| 图标 | `lucide-react` |
| Markdown 解析 | `markdown-it` |
| 标题锚点 | `markdown-it-anchor` + `uslug` |
| 代码高亮 | `markdown-it-prism` + `prismjs/themes/prism-tomorrow.css` |
| 数学公式 | `markdown-it-katex` |
| Markdown 默认样式 | `github-markdown-css` |
| HTML 净化 | `DOMPurify` |
| 左侧目录 | `tocbot` |
| URL 查询解析 | `query-string` |

## 4. 页面数据流

详情页主流程如下：

```text
进入 /knowledge-base/detail/:id
  -> KnowledgeBaseDetail 读取路由参数 id
  -> 解析 query 参数 q、anchor
  -> useKBDetailStore.loadDetail(id)
  -> getKnowledgeBaseItem(id)
  -> POST /kb/document/detail
  -> 得到 SearchKnowledgeBaseItem
  -> useKBMarkdown(detailData)
  -> 如有 cos_md_path，从 COS 拉取 .md
  -> 如无或加载失败，使用详情字段拼 fallback Markdown
  -> Markdown 组件渲染正文、目录、锚点、搜索高亮
```

页面中解析的 URL 参数：

| 参数 | 来源 | 用途 |
| --- | --- | --- |
| `id` | path param | `user_document_id`，用于获取文档详情 |
| `q` | query string | 搜索关键词，高亮正文命中内容 |
| `anchor` | query string | 指定标题锚点，渲染后自动滚动 |

搜索页跳转详情时会携带：

```ts
navigate(`/knowledge-base/detail/${item.user_document_id}?q=${q}&anchor=${item.anchor_key}`);
```

## 5. 详情页组件结构

`KnowledgeBaseDetail` 的主要职责：

1. 通过 `useParams` 读取 `id`。
2. 通过 `query-string` 解析 `location.search` 中的 `q` 和 `anchor`。
3. 从 `useKBDetailStore` 获取 `detailData`、`detailLoading`、`detailError`、`loadDetail`、`clearDetail`。
4. 在 `useEffect` 中调用 `loadDetail(id)`，卸载时 `clearDetail()`。
5. 调用 `useKBMarkdown(detailData)` 得到最终 Markdown 字符串。
6. 根据 loading/error/data 渲染不同状态。
7. 把内容和元信息传给通用 `Markdown` 组件。

核心渲染结构：

```tsx
<Markdown
  content={markdownContent}
  showToc
  docMeta={{
    title: detailData.doc_name,
    dateText: formatTime(detailData.created_at, 'YYYY年MM月DD日'),
    ownerText: ownerTypeText,
    tags: tagsText,
    summary: detailData.description || '暂无简介',
  }}
  keyword={q}
  anchor={anchor}
/>
```

文档归属通过 `resolveKnowledgeBaseOwnerTypeLabel(detailData.owner_type)` 转成展示文案：

- `1` -> `个人`
- `2` -> `公司`

标签字段 `tags` 在页面中做了容错处理，兼容：

- `null` / `undefined`
- `string[]`
- 逗号分隔字符串
- 其他异常类型

## 6. Markdown 内容如何加载

Markdown 加载逻辑在 `src/pages/knowledge-base/hooks/use-kb-markdown.ts`。

输入：

```ts
SearchKnowledgeBaseItem | null
```

输出：

```ts
markdownContent: string
```

加载策略：

1. 如果 `detailData` 为空，不处理。
2. 根据 `detailData` 生成 fallback Markdown。
3. 如果没有 `detailData.cos_md_path`，直接使用 fallback Markdown。
4. 如果有 `cos_md_path`，通过浏览器 `fetch` 请求：

```ts
fetch(`${COS_HOST}/${detailData.cos_md_path}`, {
  signal: controller.signal,
});
```

5. 如果 COS 请求成功，使用远端 Markdown 文本。
6. 如果请求失败、响应非 OK、内容为空或组件卸载，回退到 fallback Markdown。
7. 使用 `AbortController` 在组件卸载或数据变化时取消旧请求。

fallback Markdown 由这些字段拼出：

- `doc_name`
- `anchor_key`
- `tags`
- `start_line`
- `end_line`
- `description`
- `snippet`

因此详情页并不直接把后端返回的 `snippet` 当作完整正文渲染，优先渲染 COS 上的 Markdown 文件。

## 7. 中间 Markdown 如何渲染

Markdown 渲染在 `src/components/markdown/markdown.tsx`。

### 7.1 markdown-it 初始化

初始化配置：

```ts
const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
});
```

含义：

| 配置 | 作用 |
| --- | --- |
| `html: true` | 允许 Markdown 中的 HTML |
| `linkify: true` | 自动识别链接 |
| `typographer: true` | 启用排版优化 |
| `breaks: true` | 换行转 `<br>` |

### 7.2 插件

使用的插件：

```ts
md.use(anchor, {
  permalinkBefore: true,
  slugify: legacySlugify,
  permalink: anchor.permalink.headerLink({
    class: styles.anchor,
    symbol: '#',
  }),
});

md.use(katex);

md.use(prism, {
  defaultLanguage: 'javascript',
  defaultLanguageForUnknown: 'plaintext',
  highlightInlineCode: true,
  lineNumbers: false,
});
```

插件作用：

| 插件 | 作用 |
| --- | --- |
| `markdown-it-anchor` | 给标题生成 `id` 和可点击锚点 |
| `uslug` | 生成兼容中文标题的 slug |
| `markdown-it-katex` | 渲染数学公式 |
| `markdown-it-prism` | 渲染代码块高亮 |

标题锚点使用 `uslug`：

```ts
function legacySlugify(s: string) {
  return uslug(s);
}
```

这点对中文标题比较关键，否则目录跳转和搜索页 `anchor` 跳转容易失效。

### 7.3 HTML 安全处理

渲染流程：

```text
Markdown 字符串
  -> md.render(content)
  -> 手动转义 script/style/iframe/object/embed 标签
  -> DOMPurify.sanitize()
  -> setHtml()
  -> dangerouslySetInnerHTML 渲染
```

最终渲染：

```tsx
<article
  className={classNames(styles.content, 'markdown-body')}
  id="md-content"
  ref={contentRef}
  dangerouslySetInnerHTML={{ __html: html }}
/>
```

样式来源：

- `markdown-body` 来自 `github-markdown-css/github-markdown.css`
- 代码主题来自 `prismjs/themes/prism-tomorrow.css`
- 页面布局、目录、元信息样式来自 `markdown.module.scss`

## 8. 左侧目录如何实现

左侧目录不是详情页手写的目录数据，而是由 `Markdown` 组件在 HTML 渲染后用 `tocbot` 从正文标题自动生成。

启用方式：

```tsx
<Markdown content={markdownContent} showToc />
```

DOM 结构：

```tsx
{showToc && (
  <aside className={classNames(styles.tocContainer, tocCollapsed && styles.tocCollapsed)}>
    <div className={styles.tocHeader}>
      <div className={styles.tocTitle}>
        <List />
        <span>目录</span>
      </div>
      <button onClick={() => setTocCollapsed(prev => !prev)}>
        {tocCollapsed ? <ChevronRight /> : <ChevronDown />}
      </button>
    </div>
    <div className={classNames(styles.toc, tocCollapsed && styles.tocHidden)} />
  </aside>
)}
```

`tocbot` 初始化：

```ts
tocbot.init({
  tocSelector: `.${styles.toc}`,
  contentSelector: `.${styles.content}`,
  headingSelector: 'h1, h2, h3, h4, h5, h6',
  hasInnerContainers: true,
  scrollSmooth: true,
  scrollSmoothOffset: -80,
  headingsOffset: 80,
  throttleTimeout: 100,
  positionFixedSelector: `.${styles.toc}`,
  positionFixedClass: styles.tocFixed,
  fixedSidebarOffset: 'auto',
});
```

目录生成依赖：

1. Markdown 内容先渲染成 HTML。
2. `markdown-it-anchor` 给标题生成 `id`。
3. `tocbot` 扫描正文里的 `h1` 到 `h6`。
4. `tocbot` 把目录链接写入 `styles.toc` 对应的空容器。
5. 滚动时 `tocbot` 自动更新 active link。

目录样式：

- 默认宽度 `280px`
- `position: sticky`
- `top: 0`
- 高度 `100vh`
- 内部滚动
- H1/H2/H3 通过 `.node-name--H1`、`.node-name--H2`、`.node-name--H3` 做层级缩进和字体区分
- active 项通过 `.is-active-link` 高亮并显示左侧竖条
- 折叠后宽度变为 `72px`，目录列表隐藏
- 屏幕宽度小于 `992px` 时目录隐藏

## 9. 搜索高亮和锚点跳转

`Markdown` 组件支持两个增强参数：

```ts
keyword?: string;
anchor?: string;
```

### 9.1 关键词高亮

逻辑：

1. `keyword` 按空白切词。
2. 对关键词去重。
3. 长词优先。
4. 使用 `TreeWalker` 遍历正文文本节点。
5. 跳过 `MARK`、`SCRIPT`、`STYLE`。
6. 命中内容替换为：

```html
<mark class="hit-highlight">...</mark>
```

最多高亮 `200` 处。

### 9.2 自动滚动

渲染完成后：

1. 如果传了 `anchor`，优先 `document.getElementById(anchor)`。
2. 找到目标后 `scrollIntoView({ behavior: 'smooth', block: 'start' })`。
3. 如果没有 anchor 但存在高亮，则滚动到第一个 `.hit-highlight`。

### 9.3 页内锚点点击

组件还额外监听正文内 `a[href^="#"]`：

1. 阻止默认跳转。
2. `decodeURIComponent` 处理中文锚点。
3. 找到对应 `id` 后平滑滚动。

## 10. 阅读进度和返回顶部

`Markdown` 组件监听 `window.scroll`：

- 根据 `window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)` 计算阅读进度。
- 顶部固定 `progressBar` 显示进度。
- 滚动超过 `300px` 显示返回顶部按钮。

当前 `scrollToTop` 方法里真正滚动逻辑被注释了：

```ts
const scrollToTop = useCallback(() => {
  // contentRef.current?.parentElement?.scrollTo({ top: 0, behavior: 'smooth' });
}, []);
```

也就是说按钮会显示，但当前代码不会实际回到顶部。

## 11. 接口结构

接口封装在 `src/services2/knowledge-base.ts`，统一使用 `request`。

`request` 是项目内 axios 封装，响应结构大致为：

```ts
interface ServiceResponse<T = unknown> {
  success: boolean;
  message?: string;
  code: ServiceErrorCode;
  data: T;
}
```

业务接口基本都判断：

```ts
if (err || res.code !== 1) {
  return Promise.reject(...);
}

return res.data;
```

### 11.1 详情页直接使用的接口

```ts
export const getKnowledgeBaseItem = async (
  user_document_id: string | number,
  anchor_key?: string,
  config?: AxiosRequestConfig,
): Promise<SearchKnowledgeBaseItem> => {
  const [err, res] = await awaitTo(
    request.post<SearchKnowledgeBaseItem>(
      '/kb/document/detail',
      { user_document_id, anchor_key },
      config,
    ),
  );

  if (err || res.code !== 1) {
    return Promise.reject(err ?? new Error(res.message ?? '获取知识库详情失败'));
  }

  return res.data;
};
```

请求：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_document_id` | `string | number` | 文档 ID |
| `anchor_key` | `string | undefined` | 可选锚点 key |

响应：

```ts
SearchKnowledgeBaseItem
```

注意：`kb-detail-store` 的 `loadDetail(id, anchor_key?)` 支持传 `anchor_key`，但当前详情页只调用 `loadDetail(id)`，没有把 URL 里的 `anchor` 作为 `anchor_key` 传给详情接口。

### 11.2 其他知识库接口

| 函数 | 方法和路径 | 说明 |
| --- | --- | --- |
| `preCreateKnowledgeBase()` | `POST /kb/document/create` | 预创建知识库文档 |
| `preHandleUploadKnowledgeBase(data)` | `POST /kb/document/upload/initialize` | 初始化上传 |
| `uploadChunk(data, config)` | `POST /kb/document/upload/chunks` | 上传分片 |
| `finishMergeUpload(data, config)` | `POST /kb/document/upload/finish-merge` | 合并分片 |
| `searchKnowledgeBase(data)` | `POST /kb/document/search` | 知识库搜索 |
| `getKnowledgeBaseItem(user_document_id, anchor_key, config)` | `POST /kb/document/detail` | 获取知识库详情 |
| `delKnowledgeBaseItem(user_document_id)` | `POST /kb/document/delete` | 删除知识库条目 |
| `getKnowledgeBaseList(offset, limit, sort, keyword)` | `POST /kb/document/list` | 获取知识库列表 |
| `getKnowledgeBaseViewHistory(offset, limit)` | `POST /kb/document/view-history/list` | 获取最近浏览 |
| `chatKnowledgeBaseDocument(data)` | `POST /kb/document/chat` | 文档问答 |
| `getKnowledgeBaseDocumentChatHistory(params)` | `GET /kb/document/history` | 文档问答历史 |

## 12. 类型定义

类型定义在 `src/types/knowledge-base.ts`。

### 12.1 文档归属类型

```ts
export const KnowledgeBaseOwnerType = {
  USER: 1,
  GROUP: 2,
} as const;

export type KnowledgeBaseOwnerType =
  (typeof KnowledgeBaseOwnerType)[keyof typeof KnowledgeBaseOwnerType];
```

含义：

| 值 | 含义 |
| --- | --- |
| `1` | 个人 |
| `2` | 公司 / 组织 |

工具函数：

```ts
export function normalizeKnowledgeBaseOwnerType(ownerType?: number): KnowledgeBaseOwnerTypeValue {
  return ownerType === KnowledgeBaseOwnerType.GROUP
    ? KnowledgeBaseOwnerType.GROUP
    : KnowledgeBaseOwnerType.USER;
}

export function resolveKnowledgeBaseOwnerTypeLabel(ownerType?: number): string {
  return normalizeKnowledgeBaseOwnerType(ownerType) === KnowledgeBaseOwnerType.GROUP
    ? '公司'
    : '个人';
}
```

### 12.2 上传初始化请求体

```ts
export interface UploadKnowledgeBaseFileResponse {
  owner_type: KnowledgeBaseOwnerType;
  user_document_id: number;
  cover_img: string;
  doc_name: string;
  hash: string;
  size: number;
  device_id: string;
  description: string;
  tags: string[];
}
```

### 12.3 上传状态

```ts
const UploadKnowledgeBaseFileStatus = {
  FAILED: -1,
  CREATED: 0,
  UPLOADING: 1,
  MERGING: 2,
  COMPLETED: 3,
} as const;

export type UploadKnowledgeBaseFileStatus =
  (typeof UploadKnowledgeBaseFileStatus)[keyof typeof UploadKnowledgeBaseFileStatus];
```

### 12.4 解析状态

```ts
const KnowledgeBaseParsedStatus = {
  FAILED: -1,
  PARSING: 0,
  COMPLETED: 1,
} as const;

export type KnowledgeBaseParsedStatus =
  (typeof KnowledgeBaseParsedStatus)[keyof typeof KnowledgeBaseParsedStatus];
```

### 12.5 搜索请求

```ts
export interface SearchKnowledgeBaseResponse {
  keyword: string;
  offset?: number;
  limit?: number;
}
```

### 12.6 详情 / 搜索结果项

详情页核心使用的是 `SearchKnowledgeBaseItem`：

```ts
export interface SearchKnowledgeBaseItem {
  owner_type: KnowledgeBaseOwnerType;
  user_document_id: number;
  doc_name: string;
  cover_img: string;
  created_at: Date;
  snippet: string;
  cos_md_path: string;
  start_line: number;
  end_line: number;
  anchor_key: string;
  page_count: number;
  tags: string[];
  description: string;
  upload_status: UploadKnowledgeBaseFileStatus;
  parsed_status: KnowledgeBaseParsedStatus;
}
```

列表项类型复用详情类型，但去掉搜索片段定位字段：

```ts
export type KnowledgeBaseItem =
  Omit<SearchKnowledgeBaseItem, 'start_line' | 'end_line' | 'anchor_key'>;
```

### 12.7 最近浏览

```ts
export interface KnowledgeBaseHistoryItem {
  user_document_id: number;
  doc_name: string;
  cover_img: string;
  extension: string;
  page_count: number;
  tags: string[];
  description: string;
  viewed_at: string;
}
```

### 12.8 文档问答

请求：

```ts
export interface KnowledgeBaseDocumentChatRequest {
  user_document_id: number;
  query: string;
}
```

响应当前未细化：

```ts
export type KnowledgeBaseDocumentChatResponse = unknown;
```

历史参数：

```ts
export interface KnowledgeBaseDocumentChatHistoryParams {
  user_document_id: number;
  limit: number;
}
```

历史消息：

```ts
export interface KnowledgeBaseDocumentChatHistoryMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  reference_chunk_ids: number[] | null;
  created_at: string;
}
```

## 13. 详情页状态 Store

`src/stores2/kb-detail-store.ts` 使用 Zustand：

```ts
interface KBDetailStore {
  detailData: SearchKnowledgeBaseItem | null;
  detailLoading: boolean;
  detailError: string | null;
  loadDetail: (id: string, anchor_key?: string) => Promise<void>;
  clearDetail: () => void;
}
```

状态变化：

```text
loadDetail()
  -> detailLoading = true
  -> detailData = null
  -> detailError = null
  -> 调 getKnowledgeBaseItem()
  -> 成功：detailData = res, detailLoading = false
  -> 失败：detailError = err.message, detailLoading = false, toast.error()

clearDetail()
  -> 清空 detailData/detailError/loading
```

## 14. 当前实现里值得注意的点

1. `KnowledgeBaseDetail` 中存在一个 `DetailHeader` 子组件，但实际渲染处被注释，当前顶部主要由 `KnowledgeBaseLayout` 的 `AppHeader` 负责。
2. `DetailHeader`、部分注释和文案在当前文件输出中出现乱码，说明源文件或终端编码可能存在不一致；运行时如果构建产物也是乱码，需要统一检查文件编码。
3. `useEffect` 依赖包含 `q`，但加载详情时只调用 `loadDetail(id)`，搜索关键词变化会触发详情重新请求；如果后端详情不依赖 `q`，这次重新请求可以避免。
4. `loadDetail` 支持 `anchor_key`，但详情页没有把 URL `anchor` 传进去；当前 `anchor` 只用于前端滚动。
5. 返回顶部按钮显示逻辑存在，但点击处理中的滚动代码被注释，当前不会真正滚回顶部。
6. `markdown-it` 开启了 `html: true`，虽然之后做了危险标签转义和 `DOMPurify.sanitize()`，但如果后续允许更多 HTML 能力，需要明确安全策略。

## 15. 总结

`knowledge-base/detail` 页面本质上是一个 React 阅读器页面：

- 页面入口只负责拿路由参数、请求详情、整理文档元信息。
- 详情数据通过 Zustand store 管理，请求接口是 `POST /kb/document/detail`。
- 正文优先从 COS 的 `cos_md_path` 拉取 Markdown 文件，失败则用详情字段拼 fallback Markdown。
- Markdown 渲染由通用 `Markdown` 组件完成，基于 `markdown-it` 解析，配合 anchor、KaTeX、Prism、DOMPurify 和 GitHub Markdown CSS。
- 左侧目录由 `tocbot` 自动扫描渲染后的标题生成，不依赖后端目录数据。
- 搜索页带来的 `q` 和 `anchor` 用于正文高亮和自动滚动。
