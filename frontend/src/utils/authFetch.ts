const TOKEN_KEY = 'synapse_token'

export async function authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  return fetch(input, { ...init, headers })
}
