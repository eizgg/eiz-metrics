import { describe, expect, it } from 'vitest'
import { parseMaxJobs } from '../args.js'

describe('parseMaxJobs', () => {
  it('sin flag no hay tope', () => {
    expect(parseMaxJobs(['node', 'main.ts', '--once'])).toBe(Number.POSITIVE_INFINITY)
  })

  it('lee el tope', () => {
    expect(parseMaxJobs(['node', 'main.ts', '--once', '--max', '15'])).toBe(15)
  })

  it('rechaza valores inválidos', () => {
    expect(() => parseMaxJobs(['--max'])).toThrow()
    expect(() => parseMaxJobs(['--max', '0'])).toThrow()
    expect(() => parseMaxJobs(['--max', 'diez'])).toThrow()
  })
})
