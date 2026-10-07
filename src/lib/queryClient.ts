import { QueryClient } from '@tanstack/react-query'

// Cache de servidor: los datos cambian como mucho una vez por día (cron), así que 5 min alcanza
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Códigos de PostgREST/Postgres cuando la tabla o vista todavía no existe (migración sin aplicar)
export function isMissingRelation(error: { code?: string } | null): boolean {
  return error !== null && error.code !== undefined && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code)
}
