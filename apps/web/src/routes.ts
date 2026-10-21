// No router: the only deep link is the invite, /invite/<token> under Vite's BASE_URL.

const BASE = import.meta.env.BASE_URL

function appPath(): string {
  const path = window.location.pathname
  return path.startsWith(BASE) ? path.slice(BASE.length) : path.replace(/^\//, '')
}

export function inviteTokenFromPath(): string | null {
  const match = /^invite\/([^/]+)\/?$/.exec(appPath())
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

/** Leave the invite page without a reload, so the link is gone from history. */
export function replaceWithHome(): void {
  window.history.replaceState(null, '', BASE)
}
