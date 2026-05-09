import type { GraphResponse } from '../../../src/types'

import chonglaiGraph from './chonglai'
import naerwaGraph from './naerwa'
import qiwangGraph from './qiwang'
import xiaowangziGraph from './xiaowangzi'
import xidaduoGraph from './xidaduo'

export const bookGraphMockMap: Record<string, GraphResponse> = {
  xidaduo: xidaduoGraph,
  xiaowangzi: xiaowangziGraph,
  qiwang: qiwangGraph,
  chonglai: chonglaiGraph,
  naerwa: naerwaGraph,
}

export const bookGraphMockList = Object.values(bookGraphMockMap)

export { chonglaiGraph, naerwaGraph, qiwangGraph, xiaowangziGraph, xidaduoGraph }

export default bookGraphMockMap
