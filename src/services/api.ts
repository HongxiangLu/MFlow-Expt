import axios from 'axios'

export const apiPaths = {
  chat: '/api/chat',
  bookList: '/api/book/books',
  bookContent: (bookId: string) => `/api/book/books/${bookId}/content`,
  bookChapterContent: (chapterId: string) => `/api/book/chapters/${chapterId}/content`,
  bookGraph: '/api/book/graph',
  bookGraphNodeSources: (nodeId: string) => `/api/book/graph/nodes/${nodeId}/sources`,
  bookChat: '/api/book/chat',
  graphQuery: '/api/graph/query',
} as const

const legacyApiBaseUrl = import.meta.env.VITE_API_BASE_URL

export const dashboardApiBaseUrl =
  import.meta.env.VITE_DASHBOARD_API_BASE_URL || legacyApiBaseUrl || 'http://192.168.3.250:8848'
export const bookApiBaseUrl = import.meta.env.VITE_BOOK_API_BASE_URL || 'http://127.0.0.1:8000'
export const apiBaseUrl = dashboardApiBaseUrl

export type RequestOptions = {
  signal?: AbortSignal
}

export const http = axios.create({
  baseURL: dashboardApiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

export const bookHttp = axios.create({
  baseURL: bookApiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

function getUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

export function getApiUrl(path: string) {
  return getUrl(dashboardApiBaseUrl, path)
}

export function getBookApiUrl(path: string) {
  return getUrl(bookApiBaseUrl, path)
}
