import type { ComponentType, ReactNode } from 'react'
import Book from '../pages/book/book'
import Dashboard from '../pages/dashboard/dashboard'

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
    redirect: '/dashboard',
    title: 'Dashboard',
  },
  {
    path: '/dashboard',
    element: Dashboard,
    title: 'Dashboard',
  },
  {
    path: '/book',
    element: Book,
    title: 'Book',
  },
]

export default routes
