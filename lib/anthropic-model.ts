// Capacidades por modelo de la API de Anthropic (el modelo es configurable con ANTHROPIC_MODEL)

// Haiku no soporta `output_config.effort`: la API rechaza la request con 400
export function supportsEffort(model: string): boolean {
  return !/haiku/i.test(model)
}

export function effortConfig(model: string): { output_config: { effort: 'medium' } } | Record<string, never> {
  return supportsEffort(model) ? { output_config: { effort: 'medium' } } : {}
}
