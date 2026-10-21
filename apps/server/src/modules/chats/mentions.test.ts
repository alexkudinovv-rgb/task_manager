import { describe, expect, it } from 'vitest'
import { mentionTokens, resolveMentions } from './mentions'

describe('mentions', () => {
  it('finds @login tokens, lowercased, once each', () => {
    expect(mentionTokens('@Belova посмотри, @ivanov и снова @belova')).toEqual(['belova', 'ivanov'])
  })

  it('ignores e-mails and too short logins', () => {
    expect(mentionTokens('пишите на info@carcity.ru или @ab')).toEqual([])
  })

  it('offers the login without trailing punctuation', () => {
    expect(mentionTokens('спасибо, @petrov.')).toEqual(['petrov.', 'petrov'])
  })

  it('resolves only known logins, in order of appearance', () => {
    const ids = new Map([
      ['petrov', 'u1'],
      ['belova', 'u2'],
    ])
    expect(resolveMentions('@belova и @petrov. и @nobody, ещё раз @belova', ids)).toEqual(['u2', 'u1'])
  })
})
