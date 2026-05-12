export type BookChapter = {
  id: string
  bookId?: string
  parentId?: string | null
  title: string
  order?: number
  level?: number
  summary?: string | null
  markdownPath?: string
  createdAt?: string
  updatedAt?: string
  children?: BookChapter[]
}

export type BookListItem = {
  id: string
  knowledgeBaseId?: string
  title: string
  author?: string | null
  dynasty?: string | null
  description?: string | null
  coverUrl?: string | null
  chapterCount?: number
  createdAt?: string
  updatedAt?: string
  chapters: BookChapter[]
}

export type BookListResponse = BookListItem[]

export type BookAnchor = {
  id: string
  chapterId: string
  title: string
  startOffset: number
  endOffset: number
  markdownHeading?: string | null
}

export type BookEntityMention = {
  id: string
  entityId: string
  label: string
  nodeType: string
  chapterId: string
  anchorId?: string | null
  startOffset: number
  endOffset: number
}

export type BookTextResponse = {
  chapterId?: string
  bookId: string
  title: string
  markdown: string
  anchors: BookAnchor[]
  entities: BookEntityMention[]
  content: string
}

export type BookSelectedText = {
  chapterId: string
  text: string
  startOffset: number
  endOffset: number
}

export type BookChatScope = 'chapter' | 'book'

export type BookChatRequest = {
  sessionId: string
  knowledgeBaseId?: string
  bookId?: string
  chapterId?: string
  chatScope?: BookChatScope
  question: string
  selectedText?: BookSelectedText
}

export type BookSourceRef = {
  id: string
  knowledgeBaseId?: string
  bookId: string
  bookTitle?: string
  chapterId: string
  chapterTitle?: string
  anchorId?: string | null
  title: string
  quote: string
  startOffset: number
  endOffset: number
}

export type BookChatResponse = {
  answer: string
  sourceRefs: BookSourceRef[]
  relatedNodeIds: string[]
}
