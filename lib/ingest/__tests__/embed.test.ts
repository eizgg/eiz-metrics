import { describe, expect, it } from 'vitest'
import { firstEmbedded } from '../embed.js'

describe('firstEmbedded', () => {
  it('devuelve el objeto cuando PostgREST lo manda como relación 1 a 1', () => {
    expect(firstEmbedded({ access_token: 'abc' })).toEqual({ access_token: 'abc' })
  })

  it('devuelve el primer elemento cuando viene como array', () => {
    expect(firstEmbedded([{ access_token: 'abc' }, { access_token: 'def' }])).toEqual({ access_token: 'abc' })
  })

  it('devuelve undefined si no hay embed', () => {
    expect(firstEmbedded(null)).toBeUndefined()
    expect(firstEmbedded(undefined)).toBeUndefined()
    expect(firstEmbedded([])).toBeUndefined()
  })
})
