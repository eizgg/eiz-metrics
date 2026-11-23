// Argumentos de línea de comandos del worker

// --max N: tope de jobs por corrida (cada job es una llamada a la IA). Sin flag, sin tope.
export function parseMaxJobs(argv: string[]): number {
  const i = argv.indexOf('--max')
  if (i === -1) return Number.POSITIVE_INFINITY
  const n = Number(argv[i + 1])
  if (!Number.isInteger(n) || n < 1) throw new Error('--max necesita un entero positivo')
  return n
}
