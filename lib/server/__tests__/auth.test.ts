import { beforeEach, describe, expect, it } from 'vitest'
import { signState, verifyState } from '../auth.js'

describe('state firmado de OAuth', () => {
  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'secreto-de-test'
  })

  it('valida un state propio', () => {
    const state = signState({ accountId: 'a1', userId: 'u1' })
    expect(verifyState(state)).toMatchObject({ accountId: 'a1', userId: 'u1' })
  })
  it('rechaza un state adulterado', () => {
    const state = signState({ accountId: 'a1', userId: 'u1' })
    const [body, sig] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ accountId: 'otra', userId: 'u1', exp: 9_999_999_999 })).toString('base64url')
    expect(verifyState(`${forged}.${sig}`)).toBeNull()
    expect(verifyState(`${body}.abc`)).toBeNull()
    expect(verifyState('basura')).toBeNull()
  })
  it('rechaza un state vencido', () => {
    expect(verifyState(signState({ accountId: 'a1', userId: 'u1' }, -10))).toBeNull()
  })
})
