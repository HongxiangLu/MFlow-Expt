import { apiPaths, http, type RequestOptions } from './api'
import type { GraphQueryRequest, GraphResponse } from '../types'

export async function queryGraph(request: GraphQueryRequest, { signal }: RequestOptions = {}) {
  const response = await http.post<GraphResponse>(apiPaths.graphQuery, request, { signal })

  return response.data
}
