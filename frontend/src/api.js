// Thin fetch wrapper. GET requests are memoised for the session (switching tabs is instant), and
// identical requests in flight share one promise, so a slow AI report is never requested twice.
const cache = new Map()

async function fetchJson(path) {
  const res = await fetch(`/api${path}`)
  // 502/504 from the Vite proxy means the Python backend isn't running (or is still starting).
  if (res.status === 502 || res.status === 504) {
    throw new Error("Can't reach the backend. Make sure the Python server is running, then refresh.")
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export function get(path) {
  if (!cache.has(path)) {
    const promise = fetchJson(path)
    promise.catch(() => cache.delete(path))   // don't remember failures: a retry should refetch
    cache.set(path, promise)
  }
  return cache.get(path)
}

/** Forget cached GETs whose path starts with prefix (e.g. after saving the user's profile). */
export function invalidate(prefix) {
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key)
}

export const post = (path, body) => send('POST', path, body)
export const patch = (path, body) => send('PATCH', path, body)

async function send(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 502 || res.status === 504) {
    throw new Error("Can't reach the backend. Make sure the Python server is running, then refresh.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`)
  return data
}

export function withScope(path, scope, extra = {}) {
  const params = new URLSearchParams({ ...(scope ? { scope } : {}), ...extra })
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}
