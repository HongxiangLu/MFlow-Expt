import { apiPaths, http, type RequestOptions } from './api'
import bookTitleMock from '../../mock/BOOK/book-title'
import chonglaiText from '../../mock/BOOK/book-text/chonglai.md?raw'
import naerwaText from '../../mock/BOOK/book-text/naerwa.md?raw'
import qiwangText from '../../mock/BOOK/book-text/qiwang.md?raw'
import xiaowangziText from '../../mock/BOOK/book-text/xiaowangzi.md?raw'
import xidaduoText from '../../mock/BOOK/book-text/xidaduo.md?raw'
import type { BookListResponse, BookTextResponse } from '../types'

export type BookListFetchMode = 'api' | 'fake'

export type BookListRequestOptions = RequestOptions & {
  mode?: BookListFetchMode
}

const bookTextMockMap: Record<string, string> = {
  chonglai: chonglaiText,
  naerwa: naerwaText,
  qiwang: qiwangText,
  xiaowangzi: xiaowangziText,
  xidaduo: xidaduoText,
}

function getMockBookText(bookId: string): BookTextResponse {
  const book = bookTitleMock.find((item) => item.id === bookId)

  return {
    id: bookId,
    title: book?.title ?? bookId,
    content: bookTextMockMap[bookId] ?? '',
  }
}

export async function getBookList({ signal, mode = 'api' }: BookListRequestOptions = {}) {
  if (mode === 'fake') {
    return bookTitleMock
  }

  try {
    const response = await http.get<BookListResponse>(apiPaths.bookList, { signal })

    return response.data
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    return bookTitleMock
  }
}

export async function getBookText(bookId: string, { signal, mode = 'api' }: BookListRequestOptions = {}) {
  if (mode === 'fake') {
    return getMockBookText(bookId)
  }

  try {
    const response = await http.get<BookTextResponse>(apiPaths.bookText(bookId), { signal })

    return response.data
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    return getMockBookText(bookId)
  }
}
