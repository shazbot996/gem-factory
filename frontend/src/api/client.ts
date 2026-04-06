let currentToken: string | null = null;
let refreshTokenFn: (() => Promise<boolean>) | null = null;

export function setToken(token: string | null) {
  currentToken = token;
}

export function setRefreshToken(fn: (() => Promise<boolean>) | null) {
  refreshTokenFn = fn;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL || '';

async function doRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};

  if (currentToken) {
    headers['Authorization'] = `Bearer ${currentToken}`;
  }

  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // response wasn't JSON
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  try {
    return await doRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && refreshTokenFn) {
      const refreshed = await refreshTokenFn();
      if (refreshed) {
        return doRequest<T>(path, options);
      }
    }
    throw err;
  }
}
