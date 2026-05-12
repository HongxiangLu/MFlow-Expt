# Book 页面接口说明

## 基础地址

```txt
http://127.0.0.1:8000
```

启动后端服务：

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

接口文档地址：

```txt
http://127.0.0.1:8000/docs
```

## 1. 左侧图书列表

获取 book 页面左侧图书列表和章节列表。

```txt
GET /api/book/books
```

完整地址：

```txt
http://127.0.0.1:8000/api/book/books
```

返回示例：

```json
{
  "data": [
    {
      "id": "book-bronze",
      "knowledgeBaseId": "kb-cultural-relics",
      "title": "中国青铜器",
      "author": "示例作者",
      "dynasty": null,
      "description": "青铜器基础知识与典型器物说明",
      "coverUrl": "/covers/book-bronze.png",
      "chapterCount": 2,
      "createdAt": "2026-05-11T00:00:00Z",
      "updatedAt": "2026-05-11T00:00:00Z",
      "chapters": [
        {
          "id": "chapter-bronze-01",
          "bookId": "book-bronze",
          "parentId": null,
          "title": "第一章 青铜器概述",
          "order": 1,
          "level": 1,
          "summary": "介绍青铜器的定义、用途和历史背景",
          "markdownPath": "books/book-bronze/chapter-01.md",
          "createdAt": "2026-05-11T00:00:00Z",
          "updatedAt": "2026-05-11T00:00:00Z",
          "children": []
        }
      ]
    }
  ]
}
```

## 2. 中间 Markdown 原文

根据章节 ID 获取中间区域展示的 Markdown 原文。

```txt
GET /api/book/chapters/{chapter_id}/content
```

完整地址示例：

```txt
http://127.0.0.1:8000/api/book/chapters/chapter-bronze-01/content
```

路径参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chapter_id` | string | 是 | 章节 ID |

返回示例：

```json
{
  "data": {
    "chapterId": "chapter-bronze-01",
    "bookId": "book-bronze",
    "title": "第一章 青铜器概述",
    "markdown": "# 第一章 青铜器概述\n\n青铜器是中国古代礼制、祭祀和权力表达的重要物质载体。",
    "anchors": [
      {
        "id": "anchor-bronze-artifact",
        "chapterId": "chapter-bronze-01",
        "title": "典型器物",
        "startOffset": 45,
        "endOffset": 86,
        "markdownHeading": "典型器物"
      }
    ],
    "entities": [
      {
        "id": "mention-simuwu-01",
        "entityId": "artifact-simuwu-ding",
        "label": "司母戊鼎",
        "nodeType": "artifact",
        "chapterId": "chapter-bronze-01",
        "anchorId": "anchor-bronze-artifact",
        "startOffset": 45,
        "endOffset": 49
      }
    ]
  }
}
```

## 3. 右侧 Graph 图数据

获取 book 页面右侧知识图谱数据。

```txt
GET /api/book/graph
```

完整地址：

```txt
http://127.0.0.1:8000/api/book/graph
```

返回示例：

```json
{
  "data": {
    "graphId": "graph-kb-cultural-relics",
    "centerNodeId": "kb-cultural-relics",
    "nodes": [
      {
        "id": "kb-cultural-relics",
        "label": "文物知识库",
        "nodeType": "knowledge_base",
        "description": "文物主题知识库"
      },
      {
        "id": "artifact-simuwu-ding",
        "label": "司母戊鼎",
        "nodeType": "artifact",
        "description": "商代晚期大型青铜礼器"
      }
    ],
    "edges": [
      {
        "id": "edge-book-simuwu",
        "source": "book-bronze",
        "target": "artifact-simuwu-ding",
        "label": "提到文物",
        "weight": 1
      }
    ]
  }
}
```

## 4. AI 对话

发送问题，获取 AI 回答、原文引用和相关图谱节点。

```txt
POST /api/book/chat
```

完整地址：

```txt
http://127.0.0.1:8000/api/book/chat
```

请求头：

```txt
Content-Type: application/json
```

请求体示例：

```json
{
  "sessionId": "s1",
  "knowledgeBaseId": "kb-cultural-relics",
  "bookId": "book-bronze",
  "chapterId": "chapter-bronze-01",
  "question": "司母戊鼎是什么？"
}
```

带选中文本的请求体示例：

```json
{
  "sessionId": "s1",
  "knowledgeBaseId": "kb-cultural-relics",
  "bookId": "book-bronze",
  "chapterId": "chapter-bronze-01",
  "question": "这段话说明了什么？",
  "selectedText": {
    "chapterId": "chapter-bronze-01",
    "text": "司母戊鼎是商代晚期大型青铜礼器。",
    "startOffset": 45,
    "endOffset": 63
  }
}
```

返回示例：

```json
{
  "data": {
    "answer": "这是一个 mock AI 回答，用于先跑通 book 页面联调。问题来自当前章节：司母戊鼎是什么？",
    "sourceRefs": [
      {
        "id": "source-simuwu-01",
        "knowledgeBaseId": "kb-cultural-relics",
        "bookId": "book-bronze",
        "chapterId": "chapter-bronze-01",
        "anchorId": "anchor-bronze-artifact",
        "title": "第一章 青铜器概述",
        "quote": "司母戊鼎是商代晚期大型青铜礼器。",
        "startOffset": 45,
        "endOffset": 63
      }
    ],
    "relatedNodeIds": [
      "artifact-simuwu-ding",
      "dynasty-shang"
    ]
  }
}
```

