import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setGcsAccessToken, setOnTokenInvalid } from '../api/gcsClient';
import { config } from '../config';

export interface User {
  email: string;
  name: string;
  picture: string;
  hd: string;
}

export interface AuthContextType {
  user: User | null;
  // ID token from Google Sign-In — used as the identity proof in the SPA's
  // session storage. Not used as a Bearer credential anywhere; the server
  // tier it used to authenticate against is gone.
  idToken: string | null;
  // OAuth access token for the Cloud Storage JSON API. Acquired via the
  // GIS Token Client (separate flow from the ID token).
  accessToken: string | null;
  isAuthenticated: boolean;
  signOut: () => void;
  signInAsDev: () => void;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null as AuthContextType | null);

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('gf_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [idToken, setIdToken] = useState<string | null>(() => localStorage.getItem('gf_token'));
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const idRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accessTokenTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tokenClientRef = useRef<google.accounts.oauth2.TokenClient | null>(null);
  const pendingAccessTokenResolveRef = useRef<((token: string | null) => void) | null>(null);
  const initializedRef = useRef(false);

  const clientId = config.oauthClientId;

  const updateAccessToken = useCallback((token: string | null, expiresIn?: number) => {
    setAccessTokenState(token);
    setGcsAccessToken(token);

    if (accessTokenTimerRef.current) clearTimeout(accessTokenTimerRef.current);
    if (token && expiresIn && expiresIn > 60) {
      // Refresh 60 seconds before expiry.
      accessTokenTimerRef.current = setTimeout(() => {
        if (tokenClientRef.current) {
          tokenClientRef.current.requestAccessToken({ prompt: '' });
        }
      }, (expiresIn - 60) * 1000);
    }
  }, []);

  const requestAccessToken = useCallback((): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!tokenClientRef.current) {
        resolve(null);
        return;
      }
      pendingAccessTokenResolveRef.current = resolve;
      tokenClientRef.current.requestAccessToken({ prompt: '' });
      // Failsafe: if the callback never fires, resolve null after 10 s.
      setTimeout(() => {
        if (pendingAccessTokenResolveRef.current === resolve) {
          pendingAccessTokenResolveRef.current = null;
          resolve(null);
        }
      }, 10000);
    });
  }, []);

  const handleAccessTokenResponse = useCallback(
    (response: google.accounts.oauth2.TokenResponse) => {
      if (response.error || !response.access_token) {
        updateAccessToken(null);
        if (pendingAccessTokenResolveRef.current) {
          const resolve = pendingAccessTokenResolveRef.current;
          pendingAccessTokenResolveRef.current = null;
          resolve(null);
        }
        return;
      }
      updateAccessToken(response.access_token, response.expires_in);
      if (pendingAccessTokenResolveRef.current) {
        const resolve = pendingAccessTokenResolveRef.current;
        pendingAccessTokenResolveRef.current = null;
        resolve(response.access_token);
      }
    },
    [updateAccessToken],
  );

  const ensureTokenClient = useCallback(() => {
    if (tokenClientRef.current) return tokenClientRef.current;
    if (!clientId) return null;
    if (typeof google === 'undefined' || !google.accounts?.oauth2) return null;
    tokenClientRef.current = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GCS_SCOPE,
      callback: handleAccessTokenResponse,
    });
    return tokenClientRef.current;
  }, [clientId, handleAccessTokenResponse]);

  const handleCredentialResponse = useCallback(
    (response: google.accounts.id.CredentialResponse) => {
      const credential = response.credential;
      const payload = decodeJwtPayload(credential);

      const newUser: User = {
        email: payload.email as string,
        name: payload.name as string,
        picture: (payload.picture as string) || '',
        hd: (payload.hd as string) || '',
      };

      setUser(newUser);
      setIdToken(credential);
      localStorage.setItem('gf_user', JSON.stringify(newUser));
      localStorage.setItem('gf_token', credential);

      // Schedule ID-token refresh ~5 min before expiry.
      const exp = payload.exp as number | undefined;
      if (exp) {
        const refreshIn = exp * 1000 - Date.now() - 5 * 60 * 1000;
        if (idRefreshTimerRef.current) clearTimeout(idRefreshTimerRef.current);
        if (refreshIn > 0) {
          idRefreshTimerRef.current = setTimeout(() => {
            google.accounts.id.prompt();
          }, refreshIn);
        }
      }

      // Kick off access-token acquisition for GCS reads.
      const client = ensureTokenClient();
      if (client) {
        client.requestAccessToken({ prompt: '', hint: newUser.email });
      }
    },
    [ensureTokenClient],
  );

  const signInAsDev = useCallback(() => {
    if (clientId) return;
    const devUser: User = { email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' };
    setUser(devUser);
    setIdToken(null);
    updateAccessToken(null);
    localStorage.setItem('gf_user', JSON.stringify(devUser));
  }, [clientId, updateAccessToken]);

  const signOut = useCallback(() => {
    if (user?.email && clientId) {
      try {
        google.accounts.id.revoke(user.email, () => {});
      } catch {
        // GIS not loaded, ignore
      }
    }
    if (accessToken && clientId) {
      try {
        google.accounts.oauth2.revoke(accessToken);
      } catch {
        // GIS not loaded, ignore
      }
    }
    setUser(null);
    setIdToken(null);
    updateAccessToken(null);
    localStorage.removeItem('gf_user');
    localStorage.removeItem('gf_token');
    if (idRefreshTimerRef.current) clearTimeout(idRefreshTimerRef.current);
    if (accessTokenTimerRef.current) clearTimeout(accessTokenTimerRef.current);
  }, [user, accessToken, clientId, updateAccessToken]);

  useEffect(() => {
    // Dev bypass — no Google Sign-In configured.
    if (!clientId) {
      const cachedUser = localStorage.getItem('gf_user');
      if (cachedUser) {
        setUser(JSON.parse(cachedUser));
      } else {
        const devUser: User = { email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' };
        setUser(devUser);
        localStorage.setItem('gf_user', JSON.stringify(devUser));
      }
      setIdToken(null);
      updateAccessToken(null);
      setIsLoading(false);
      return;
    }

    // Wire up a refresh callback the GCS client will invoke on 401.
    setOnTokenInvalid(() => requestAccessToken());

    if (initializedRef.current) return;

    // Check whether the cached ID token is still valid.
    let cachedTokenExp: number | null = null;
    if (idToken) {
      try {
        const payload = decodeJwtPayload(idToken);
        const exp = payload.exp as number | undefined;
        if (exp && exp * 1000 > Date.now()) cachedTokenExp = exp;
      } catch {
        // Corrupt token; treat as no session.
      }
    }

    const initGis = () => {
      if (typeof google !== 'undefined' && google.accounts?.id && google.accounts?.oauth2) {
        if (initializedRef.current) return;
        initializedRef.current = true;

        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: true,
        });
        ensureTokenClient();

        if (cachedTokenExp && user) {
          // Cached session is still valid — set up an ID-token refresh
          // timer and acquire a fresh access token for GCS reads.
          const refreshIn = cachedTokenExp * 1000 - Date.now() - 5 * 60 * 1000;
          if (idRefreshTimerRef.current) clearTimeout(idRefreshTimerRef.current);
          if (refreshIn > 0) {
            idRefreshTimerRef.current = setTimeout(() => {
              google.accounts.id.prompt();
            }, refreshIn);
          }
          const client = tokenClientRef.current;
          if (client) {
            client.requestAccessToken({ prompt: '', hint: user.email });
          }
        } else {
          // No valid cached session — prompt for sign-in / auto-select.
          google.accounts.id.prompt();
        }

        setIsLoading(false);
      } else {
        setTimeout(initGis, 100);
      }
    };

    initGis();

    return () => {
      if (idRefreshTimerRef.current) clearTimeout(idRefreshTimerRef.current);
      if (accessTokenTimerRef.current) clearTimeout(accessTokenTimerRef.current);
      setOnTokenInvalid(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, handleCredentialResponse]);

  return (
    <AuthContext.Provider
      value={{
        user,
        idToken,
        accessToken,
        isAuthenticated: !!user,
        signOut,
        signInAsDev,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
