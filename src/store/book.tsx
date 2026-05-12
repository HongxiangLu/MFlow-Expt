
import { useEffect, useRef } from 'react'
import { create } from 'zustand'

import { getBookContent, getBookList } from '../services'
import type { BookChapter, BookListItem, BookTextResponse } from '../types'

const markdownHeadingSelector = 'h1, h2, h3, h4, h5, h6'

type BookStore = {
  books: BookListItem[]
  expandedBookIds: Set<string>
  selectedBookId: string | null
  selectedChapterId: string | null
  pendingHeadingCandidates: string[]
  bookText: BookTextResponse | null
  isBookListLoading: boolean
  isBookTextLoading: boolean
  bookListError: string | null
  bookTextError: string | null
  setBookListLoading: () => void
  setBookList: (books: BookListItem[]) => void
  setBookListError: (message: string) => void
  setBookTextLoading: () => void
  setBookText: (bookText: BookTextResponse) => void
  setBookTextError: (message: string) => void
  selectBook: (bookId: string) => void
  selectChapter: (bookId: string, chapter: BookChapter) => void
}

const initialBookState = {
  books: [] as BookListItem[],
  expandedBookIds: new Set<string>(),
  selectedBookId: null,
  selectedChapterId: null,
  pendingHeadingCandidates: [] as string[],
  bookText: null as BookTextResponse | null,
  isBookListLoading: true,
  isBookTextLoading: false,
  bookListError: null as string | null,
  bookTextError: null as string | null,
}

function getChapterHeadingCandidates(chapter: BookChapter) {
  const candidates = [chapter.title]
  const shortTitle = chapter.title.split(/\s+/).at(-1)

  if (shortTitle && shortTitle !== chapter.title) {
    candidates.push(shortTitle)
  }

  return candidates
}

function getFirstChapter(chapters: BookChapter[]): BookChapter | null {
  return chapters[0] ?? null
}

function getBookFirstChapter(book: BookListItem | undefined) {
  return book ? getFirstChapter(book.chapters) : null
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (typeof error === 'object' && error) {
    const maybeCanceledError = error as { code?: unknown; name?: unknown }

    return maybeCanceledError.code === 'ERR_CANCELED' || maybeCanceledError.name === 'CanceledError'
  }

  return false
}

const useBookStore = create<BookStore>((set) => ({
  ...initialBookState,
  setBookListLoading: () => set({ isBookListLoading: true, bookListError: null }),
  setBookList: (books) =>
    set((state) => {
      const selectedBook = books.find((book) => book.id === state.selectedBookId) ?? books[0]
      const selectedChapter = getBookFirstChapter(selectedBook)

      return {
        books,
        expandedBookIds: selectedBook ? new Set([selectedBook.id]) : new Set<string>(),
        selectedBookId: selectedBook?.id ?? null,
        selectedChapterId: selectedChapter?.id ?? null,
        pendingHeadingCandidates: selectedChapter ? getChapterHeadingCandidates(selectedChapter) : [],
        isBookListLoading: false,
        bookListError: null,
      }
    }),
  setBookListError: (message) => set({ isBookListLoading: false, bookListError: message }),
  setBookTextLoading: () => set({ isBookTextLoading: true, bookTextError: null }),
  setBookText: (bookText) => set({ bookText, isBookTextLoading: false, bookTextError: null }),
  setBookTextError: (message) => set({ bookText: null, isBookTextLoading: false, bookTextError: message }),
  selectBook: (bookId) =>
    set((state) => {
      const expandedBookIds = new Set(state.expandedBookIds)
      const book = state.books.find((item) => item.id === bookId)
      const firstChapter = getBookFirstChapter(book)

      if (expandedBookIds.has(bookId)) {
        expandedBookIds.delete(bookId)
      } else {
        expandedBookIds.add(bookId)
      }

      return {
        expandedBookIds,
        selectedBookId: bookId,
        selectedChapterId: firstChapter?.id ?? null,
        pendingHeadingCandidates: firstChapter ? getChapterHeadingCandidates(firstChapter) : [],
      }
    }),
  selectChapter: (bookId, chapter) =>
    set({
      selectedBookId: bookId,
      selectedChapterId: chapter.id,
      pendingHeadingCandidates: getChapterHeadingCandidates(chapter),
    }),
}))

async function requestBookList(signal?: AbortSignal) {
  const { setBookListLoading, setBookList, setBookListError } = useBookStore.getState()

  setBookListLoading()

  try {
    const books = await getBookList({ signal })
    setBookList(books)
  } catch (error) {
    if (isAbortError(error)) {
      return
    }

    setBookListError(error instanceof Error ? error.message : '图书列表加载失败')
  }
}

async function requestBookText(bookId: string, signal?: AbortSignal) {
  const { setBookTextLoading, setBookText, setBookTextError } = useBookStore.getState()

  setBookTextLoading()

  try {
    const bookText = await getBookContent(bookId, { signal })
    setBookText(bookText)
  } catch (error) {
    if (isAbortError(error)) {
      return
    }

    setBookTextError(error instanceof Error ? error.message : '图书原文加载失败')
  }
}

export function useBookStoreController() {
  const books = useBookStore((state) => state.books)
  const expandedBookIds = useBookStore((state) => state.expandedBookIds)
  const selectedBookId = useBookStore((state) => state.selectedBookId)
  const selectedChapterId = useBookStore((state) => state.selectedChapterId)
  const pendingHeadingCandidates = useBookStore((state) => state.pendingHeadingCandidates)
  const bookText = useBookStore((state) => state.bookText)
  const isBookListLoading = useBookStore((state) => state.isBookListLoading)
  const isBookTextLoading = useBookStore((state) => state.isBookTextLoading)
  const bookListError = useBookStore((state) => state.bookListError)
  const bookTextError = useBookStore((state) => state.bookTextError)
  const selectBook = useBookStore((state) => state.selectBook)
  const selectChapter = useBookStore((state) => state.selectChapter)
  const centerColumnRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    void requestBookList(controller.signal)

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!selectedBookId) {
      return
    }

    const controller = new AbortController()

    void requestBookText(selectedBookId, controller.signal)

    return () => {
      controller.abort()
    }
  }, [selectedBookId])

  useEffect(() => {
    if (pendingHeadingCandidates.length === 0 || !bookText?.content) {
      return
    }

    const centerColumn = centerColumnRef.current
    const headings = Array.from(centerColumn?.querySelectorAll(markdownHeadingSelector) ?? [])
    const exactTargetHeading = headings.find((heading) =>
      pendingHeadingCandidates.some((candidate) => heading.textContent?.trim() === candidate),
    )
    const fuzzyTargetHeading =
      exactTargetHeading ??
      headings.find((heading) => {
        const headingText = heading.textContent?.trim()
        if (!headingText) return false

        return pendingHeadingCandidates.some(
          (candidate) => headingText.includes(candidate) || candidate.includes(headingText),
        )
      })

    fuzzyTargetHeading?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [bookText?.content, pendingHeadingCandidates])

  function handleSelectBook(bookId: string) {
    selectBook(bookId)
    centerColumnRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleSelectChapter(book: BookListItem, chapter: BookChapter) {
    selectChapter(book.id, chapter)
  }

  return {
    books,
    expandedBookIds,
    selectedBookId,
    selectedChapterId,
    bookText,
    isBookListLoading,
    isBookTextLoading,
    bookListError,
    bookTextError,
    centerColumnRef,
    handleSelectBook,
    handleSelectChapter,
  }
}
