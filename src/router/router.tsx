import AiGuide from '../pages/ai-guide/ai-guide'
import type { ComponentType, ReactNode } from 'react'
import Book from '../pages/book/book'
import Collection from '../pages/collection/collection'
import Exhibitions from '../pages/exhibitions/exhibitions'
import Search from '../pages/search/search'
import Tour from '../pages/tour/tour'

export interface RouteConfig {
  path: string
  element?: ComponentType
  layout?: ComponentType<{ children?: ReactNode }>
  children?: RouteConfig[]
  requireAuth?: boolean
  requireAdmin?: boolean
  redirect?: string
  title?: string
}

const routes: RouteConfig[] = [
  {
    path: '/',
    redirect: '/dashboard/ai-guide',
    title: 'AI Guide',
  },
  {
    path: '/dashboard',
    redirect: '/dashboard/ai-guide',
    title: 'AI Guide',
  },
  {
    path: '/dashboard/collection',
    element: Collection,
    title: 'Collection',
  },
  {
    path: '/dashboard/search',
    element: Search,
    title: 'Search',
  },
  {
    path: '/dashboard/ai-guide',
    element: AiGuide,
    title: 'AI Guide',
  },
  {
    path: '/dashboard/tour',
    element: Tour,
    title: 'Tour',
  },
  {
    path: '/dashboard/exhibitions',
    element: Exhibitions,
    title: 'Exhibitions',
  },
  {
    path: '/book',
    element: Book,
    title: 'Book',
  },
]

export default routes
