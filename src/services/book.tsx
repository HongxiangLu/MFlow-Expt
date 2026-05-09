import { apiPaths, http, type RequestOptions } from './api'
import bookTitleMock from '../../mock/BOOK/book-title'
import type { BookListResponse } from '../types'

export type BookListFetchMode = 'api' | 'fake'

export type BookListRequestOptions = RequestOptions & {
  mode?: BookListFetchMode
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
