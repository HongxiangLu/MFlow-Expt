import axios from 'axios'

export const apiPaths = {
  chat: '/api/chat',
  bookList: '/api/books',
  bookText: (bookId: string) => `/api/books/${bookId}/text`,
  graphQuery: '/api/graph/query',
} as const

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.157:8848'

export type RequestOptions = {
  signal?: AbortSignal
}

export const http = axios.create({
  baseURL: apiBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function getApiUrl(path: string) {
  return `${apiBaseUrl.replace(/\/$/, '')}${path}`
}
