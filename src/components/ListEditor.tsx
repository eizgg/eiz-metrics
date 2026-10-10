import { useState, type KeyboardEvent } from 'react'
import { Button, COLORS, Icon, inputStyle } from './ui'

// Editor de listas cortas (reglas, objetivos, audios, formatos): chips con borrar + input para agregar.

interface ListEditorProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  color?: string
  ariaLabel: string
  max?: number
}

export function ListEditor({ values, onChange, placeholder, color = COLORS.primary, ariaLabel, max = 20 }: ListEditorProps) {
  const [draft, setDraft] = useState('')

  function add() {
    const v = draft.trim()
    if (!v || values.includes(v) || values.length >= max) return
    onChange([...values, v])
    setDraft('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {values.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {values.map((v) => (
            <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px 4px 10px', borderRadius: 999, fontSize: 12, color, background: `${color}14`, border: `1px solid ${color}40`, maxWidth: '100%' }}>
              <span style={{ overflowWrap: 'anywhere' }}>{v}</span>
              <button type="button" aria-label={`Quitar ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} style={{ display: 'inline-flex', background: 'transparent', border: 'none', color, cursor: 'pointer', padding: 0 }}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label={ariaLabel} style={{ ...inputStyle, flex: 1, minWidth: 0 }} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        <Button size="sm" variant="ghost" icon="plus" ariaLabel={`Agregar a ${ariaLabel}`} disabled={!draft.trim()} onClick={add}>Agregar</Button>
      </div>
    </div>
  )
}
