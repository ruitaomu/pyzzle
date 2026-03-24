const COOKIE_NAME = 'pyzzle_user_id'
const NAME_COOKIE_NAME = 'pyzzle_user_name'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

function readCookie(name: string): string | null {
  const entries = document.cookie.split(';').map((item) => item.trim())
  for (const entry of entries) {
    if (!entry.startsWith(`${name}=`)) {
      continue
    }
    return decodeURIComponent(entry.slice(name.length + 1))
  }
  return null
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`
}

function createRandomUserId(): string {
  const randomPart = `${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16).slice(-6)}`
  return `u-${randomPart}`
}

export function ensureUserId(): string {
  const existing = readCookie(COOKIE_NAME)
  if (existing) {
    return existing
  }
  const next = createRandomUserId()
  writeCookie(COOKIE_NAME, next)
  return next
}

export function getUserName(): string {
  return readCookie(NAME_COOKIE_NAME) ?? ''
}

export function setUserName(name: string): void {
  const normalized = name.trim()
  writeCookie(NAME_COOKIE_NAME, normalized)
}
