import { useSyncExternalStore } from 'react'

// Breakpoints: el layout usa inline styles, así que los cambios estructurales
// (nav inferior, filas → tarjetas, grillas) se deciden en JS con media queries.
export const BREAKPOINTS = {
  mobile: '(max-width: 720px)',
  tablet: '(max-width: 1024px)',
} as const

function subscribe(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => false
  )
}

export function useIsMobile(): boolean {
  return useMediaQuery(BREAKPOINTS.mobile)
}

export function useIsTablet(): boolean {
  return useMediaQuery(BREAKPOINTS.tablet)
}
