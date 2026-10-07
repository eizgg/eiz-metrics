import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

// Avisos efímeros (éxito / error / info) visibles en cualquier tamaño de pantalla.
// Reemplazan los mensajes de texto al pie de página, que en celular quedaban fuera de vista.

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

interface ToastContextValue {
  toasts: Toast[]
  push: (kind: ToastKind, text: string) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = ++counter.current
    setToasts((prev) => [...prev.slice(-2), { id, kind, text }])
    window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500)
  }, [dismiss])

  const value = useMemo<ToastContextValue>(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider')
  return ctx
}
