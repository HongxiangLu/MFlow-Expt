export type BookChapter = {
  id: string
  title: string
}

export type BookListItem = {
  id: string
  title: string
  chapters: BookChapter[]
}

export type BookListResponse = BookListItem[]
