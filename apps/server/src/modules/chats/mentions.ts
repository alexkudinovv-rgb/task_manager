// `@login` not glued to a word before it (so e-mails don't count). Logins follow the shared Login schema.
const MENTION = /(?<![\p{L}\p{N}_.@-])@([a-z][a-z0-9._-]{2,31})/giu

/**
 * Login candidates mentioned in `body`, lowercased, in order of first appearance. A trailing
 * dot, dash or underscore is sentence punctuation more often than part of a login, so both
 * spellings are returned and the caller keeps whichever exists.
 */
export function mentionTokens(body: string): string[] {
  const tokens: string[] = []
  for (const match of body.matchAll(MENTION)) {
    const login = match[1]!.toLowerCase()
    tokens.push(login)
    const trimmed = login.replace(/[._-]+$/, '')
    if (trimmed !== login && trimmed.length >= 3) tokens.push(trimmed)
  }
  return [...new Set(tokens)]
}

/** User ids for the tokens of `body`, given the logins that resolve (login -> user id). */
export function resolveMentions(body: string, idsByLogin: Map<string, string>): string[] {
  const ids: string[] = []
  for (const match of body.matchAll(MENTION)) {
    const login = match[1]!.toLowerCase()
    const id = idsByLogin.get(login) ?? idsByLogin.get(login.replace(/[._-]+$/, ''))
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}
