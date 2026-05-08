import { createElement, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import routes, { type RouteConfig } from './router'

type ResolvedRoute = RouteConfig & {
  node: ReactNode
}

function renderRouteElement(route: RouteConfig, parentLayouts: NonNullable<RouteConfig['layout']>[] = []) {
  let routeNode: ReactNode = null

  if (route.redirect) {
    routeNode = <Navigate to={route.redirect} replace />
  } else if (route.element) {
    routeNode = createElement(route.element)
  }

  const layouts = route.layout ? [...parentLayouts, route.layout] : parentLayouts

  return layouts.reduceRight<ReactNode>((children, Layout) => <Layout>{children}</Layout>, routeNode)
}

function resolveRoutes(
  routeList: RouteConfig[],
  parentLayouts: NonNullable<RouteConfig['layout']>[] = [],
): ResolvedRoute[] {
  return routeList.flatMap((route) => {
    const currentLayouts = route.layout ? [...parentLayouts, route.layout] : parentLayouts
    const resolvedRoute: ResolvedRoute = {
      ...route,
      node: renderRouteElement(route, parentLayouts),
    }

    if (!route.children) {
      return [resolvedRoute]
    }

    return [resolvedRoute, ...resolveRoutes(route.children, currentLayouts)]
  })
}

const resolvedRoutes = resolveRoutes(routes)

function RouteTitle() {
  const location = useLocation()

  useEffect(() => {
    const matchedRoute = resolvedRoutes.find((route) => route.path === location.pathname)

    if (matchedRoute?.title) {
      document.title = matchedRoute.title
    }
  }, [location.pathname])

  return null
}

function RouterRoutes() {
  return (
    <>
      <RouteTitle />
      <Routes>
        {resolvedRoutes.map((route) => (
          <Route element={route.node} key={route.path} path={route.path} />
        ))}
      </Routes>
    </>
  )
}

export default function RouterView() {
  return (
    <BrowserRouter>
      <RouterRoutes />
    </BrowserRouter>
  )
}
