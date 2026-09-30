import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { isMissingRelation } from '../lib/queryClient'
import { useAuth } from './AuthContext'
import type { Account } from '../types/insights'

// legacy: todavía no se aplicó la migración multi-cuenta → se muestra todo sin filtrar por cuenta
// multi: hay accounts del usuario; el accountId activo filtra todos los hooks
export type AccountMode = 'loading' | 'legacy' | 'multi' | 'needs-login'

interface AccountContextValue {
  mode: AccountMode
  accounts: Account[]
  accountId: string | null
  account: Account | null
  setAccountId: (id: string) => void
}

const AccountContext = createContext<AccountContextValue | null>(null)

interface AccountRow {
  id: string
  name: string
  slug: string
  niche: string | null
}

async function fetchAccounts(): Promise<{ accounts: Account[]; tableMissing: boolean }> {
  const { data, error } = await supabase.from('accounts').select('id, name, slug, niche').order('created_at')
  if (isMissingRelation(error)) return { accounts: [], tableMissing: true }
  if (error) throw new Error(error.message)
  return { accounts: ((data ?? []) as AccountRow[]).map((a) => ({ ...a })), tableMissing: false }
}

// ¿Se pueden leer videos sin sesión? (RLS público de la etapa previa a la migración 0003)
async function probeLegacyRead(): Promise<boolean> {
  const { data, error } = await supabase.from('videos').select('id').limit(1)
  return !error && (data?.length ?? 0) > 0
}

const STORAGE_KEY = 'eiz-metrics:accountId'

function readStoredAccount(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

interface AccountProviderProps {
  children: ReactNode
}

export function AccountProvider({ children }: AccountProviderProps) {
  const { session, loading: authLoading } = useAuth()
  const [selected, setSelected] = useState<string | null>(readStoredAccount)

  const accountsQuery = useQuery({
    queryKey: ['accounts', session?.user.id ?? 'anon'],
    queryFn: fetchAccounts,
    enabled: !authLoading,
    retry: false, // si la base no responde, caemos rápido al modo legado/demo
  })
  const legacyQuery = useQuery({
    queryKey: ['legacy-probe'],
    queryFn: probeLegacyRead,
    enabled: !authLoading && !session,
    retry: false,
  })

  const accounts = useMemo(() => accountsQuery.data?.accounts ?? [], [accountsQuery.data])

  const value = useMemo<AccountContextValue>(() => {
    // La cuenta activa es la elegida si sigue existiendo; si no, la primera
    const account = accounts.find((a) => a.id === selected) ?? accounts[0] ?? null
    let mode: AccountMode = 'loading'
    if (!authLoading && !accountsQuery.isLoading) {
      // Sin tabla accounts, o con la base inalcanzable, se sirve el modo legado (data de ejemplo incluida)
      const legacyOnly = accountsQuery.isError || accountsQuery.data?.tableMissing === true
      if (accounts.length > 0) mode = 'multi'
      else if (session || legacyOnly) mode = 'legacy'
      else if (legacyQuery.isLoading) mode = 'loading'
      else mode = legacyQuery.data ? 'legacy' : 'needs-login'
    }
    return {
      mode,
      accounts,
      account,
      accountId: account?.id ?? null,
      setAccountId: (id) => {
        setSelected(id)
        try {
          window.localStorage.setItem(STORAGE_KEY, id)
        } catch {
          // sin storage: la selección vive solo en memoria
        }
      },
    }
  }, [accounts, selected, authLoading, accountsQuery.isLoading, accountsQuery.isError, accountsQuery.data, session, legacyQuery.isLoading, legacyQuery.data])

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount debe usarse dentro de AccountProvider')
  return ctx
}
