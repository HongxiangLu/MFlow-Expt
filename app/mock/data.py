TIMESTAMP = "2026-05-11T00:00:00Z"

KNOWLEDGE_BASES = [
    {
        "id": "kb-cultural-relics",
        "name": "文物知识库",
        "description": "文物、朝代、材质、工艺和遗址关系知识库",
        "coverUrl": "/covers/kb-cultural-relics.png",
        "bookCount": 1,
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
    }
]

BOOKS = [
    {
        "id": "book-bronze",
        "knowledgeBaseId": "kb-cultural-relics",
        "title": "中国青铜器",
        "author": "示例作者",
        "dynasty": None,
        "description": "青铜器基础知识与典型器物说明",
        "coverUrl": "/covers/book-bronze.png",
        "chapterCount": 2,
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
    }
]

CHAPTERS = [
    {
        "id": "chapter-bronze-01",
        "bookId": "book-bronze",
        "parentId": None,
        "title": "第一章 青铜器概述",
        "order": 1,
        "level": 1,
        "summary": "介绍青铜器的定义、用途和历史背景",
        "markdownPath": "books/book-bronze/chapter-01.md",
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
        "children": [],
    },
    {
        "id": "chapter-bronze-02",
        "bookId": "book-bronze",
        "parentId": None,
        "title": "第二章 礼制与器物",
        "order": 2,
        "level": 1,
        "summary": "介绍青铜礼器与商周礼制的关系",
        "markdownPath": "books/book-bronze/chapter-02.md",
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
        "children": [],
    },
]

CHAPTER_CONTENTS = {
    "chapter-bronze-01": {
        "chapterId": "chapter-bronze-01",
        "bookId": "book-bronze",
        "title": "第一章 青铜器概述",
        "markdown": (
            "# 第一章 青铜器概述\n\n"
            "青铜器是中国古代礼制、祭祀和权力表达的重要物质载体。\n\n"
            "## 典型器物\n\n"
            "[司母戊鼎](graph://artifact-simuwu-ding) 是商代晚期大型青铜礼器。"
        ),
        "anchors": [
            {
                "id": "anchor-bronze-artifact",
                "chapterId": "chapter-bronze-01",
                "title": "典型器物",
                "startOffset": 45,
                "endOffset": 86,
                "markdownHeading": "典型器物",
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
                "endOffset": 49,
            }
        ],
    },
    "chapter-bronze-02": {
        "chapterId": "chapter-bronze-02",
        "bookId": "book-bronze",
        "title": "第二章 礼制与器物",
        "markdown": (
            "# 第二章 礼制与器物\n\n"
            "商周时期的青铜礼器常用于祭祀、宴飨和等级秩序表达。"
        ),
        "anchors": [],
        "entities": [],
    },
}

GRAPH_NODES = [
    {
        "id": "kb-cultural-relics",
        "label": "文物知识库",
        "nodeType": "knowledge_base",
        "description": "文物主题知识库",
    },
    {
        "id": "book-bronze",
        "label": "中国青铜器",
        "nodeType": "book",
        "description": "青铜器基础知识",
    },
    {
        "id": "artifact-simuwu-ding",
        "label": "司母戊鼎",
        "nodeType": "artifact",
        "description": "商代晚期大型青铜礼器",
    },
    {
        "id": "dynasty-shang",
        "label": "商代",
        "nodeType": "dynasty",
        "description": "中国青铜文明的重要时期",
    },
]

GRAPH_EDGES = [
    {
        "id": "edge-kb-book-bronze",
        "source": "kb-cultural-relics",
        "target": "book-bronze",
        "label": "包含书籍",
        "weight": 1,
    },
    {
        "id": "edge-book-simuwu",
        "source": "book-bronze",
        "target": "artifact-simuwu-ding",
        "label": "提到文物",
        "weight": 1,
    },
    {
        "id": "edge-simuwu-shang",
        "source": "artifact-simuwu-ding",
        "target": "dynasty-shang",
        "label": "所属时期",
        "weight": 1,
    },
]

KNOWLEDGE_BASE_GRAPHS = {
    "kb-cultural-relics": {
        "graphId": "graph-kb-cultural-relics",
        "centerNodeId": "kb-cultural-relics",
        "nodes": GRAPH_NODES,
        "edges": GRAPH_EDGES,
    }
}

CHAPTER_GRAPHS = {
    "chapter-bronze-01": {
        "graphId": "graph-chapter-bronze-01",
        "centerNodeId": "artifact-simuwu-ding",
        "nodes": [GRAPH_NODES[2], GRAPH_NODES[3]],
        "edges": [GRAPH_EDGES[2]],
    }
}

DEFAULT_SOURCE_REF = {
    "id": "source-simuwu-01",
    "knowledgeBaseId": "kb-cultural-relics",
    "bookId": "book-bronze",
    "chapterId": "chapter-bronze-01",
    "anchorId": "anchor-bronze-artifact",
    "title": "第一章 青铜器概述",
    "quote": "司母戊鼎是商代晚期大型青铜礼器。",
    "startOffset": 45,
    "endOffset": 63,
}

GRAPH_SOURCES = {
    "artifact-simuwu-ding": [DEFAULT_SOURCE_REF],
    "dynasty-shang": [DEFAULT_SOURCE_REF],
}
