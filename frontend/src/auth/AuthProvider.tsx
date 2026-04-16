import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { setToken as setApiToken, setRefreshToken } from '../api/client';
import { pushAuthToExtension, clearAuthInExtension } from './extensionBridge';
import { getMe } from '../api/users';

export interface User {
  email: string;
  name: string;
  picture: string;
  hd: string;
  isAdmin?: boolean;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  signOut: () => void;
  signInAsDev: () => void;
  isLoading: boolean;
}

export const AuthContext = createContext<AuthContextType | null>(null as AuthContextType | null);

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // Fetch /api/users/me to get the authoritative isAdmin flag (and anything
  // else the server wants the SPA to know about the current user). Fires
  // after any successful authentication (real sign-in or dev bypass).
  const fetchAdminFlag = useCallback(async (currentEmail: string) => {
    try {
      const profile = await getMe();
      // Guard against races: only apply the flag if the user hasn't changed
      // while the request was in flight.
      setUser((prev) => {
        if (!prev || prev.email !== currentEmail) return prev;
        return { ...prev, isAdmin: !!profile.isAdmin };
      });
    } catch {
      // Non-fatal — UI can fall back to treating the user as non-admin.
    }
  }, []);

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
      setToken(credential);
      setApiToken(credential);

      // Push the fresh session to the extension so it can call the API
      // on behalf of this user.
      const exp = payload.exp as number | undefined;
      const expiresAt = exp ? exp * 1000 : null;
      pushAuthToExtension({
        token: credential,
        email: newUser.email,
        name: newUser.name,
        expiresAt,
      });

      // Load admin flag from the API (authoritative source).
      fetchAdminFlag(newUser.email);

      // Set up token refresh timer — fires ~5 min before expiry.
      if (exp) {
        const refreshIn = exp * 1000 - Date.now() - 5 * 60 * 1000;
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        if (refreshIn > 0) {
          refreshTimerRef.current = setTimeout(() => {
            google.accounts.id.prompt();
          }, refreshIn);
        }
      }
    },
    [fetchAdminFlag],
  );

  const attemptRefresh = useCallback(async (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!clientId) {
        resolve(false);
        return;
      }
      try {
        google.accounts.id.prompt((notification) => {
          if (notification.isSkippedMoment() || notification.isDismissedMoment()) {
            resolve(false);
          }
          // If successful, handleCredentialResponse fires via the callback
          // and we resolve true after a short delay
        });
        // GIS prompt success goes through the initialize callback
        // Give it a moment to process
        setTimeout(() => resolve(!!token), 1000);
      } catch {
        resolve(false);
      }
    });
  }, [clientId, token]);

  const signInAsDev = useCallback(() => {
    // Only meaningful when no Google client ID is configured. In production
    // (clientId set), this is a no-op; real sign-in goes through GIS.
    if (clientId) return;
    const devUser: User = { email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' };
    setUser(devUser);
    setToken(null);
    setApiToken(null);
    pushAuthToExtension({
      token: null,
      email: devUser.email,
      name: devUser.name,
      expiresAt: null,
    });
    fetchAdminFlag(devUser.email);
  }, [clientId, fetchAdminFlag]);

  const signOut = useCallback(() => {
    if (user?.email) {
      try {
        google.accounts.id.revoke(user.email, () => {});
      } catch {
        // GIS not loaded, ignore
      }
    }
    setUser(null);
    setToken(null);
    setApiToken(null);
    clearAuthInExtension();
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, [user]);

  useEffect(() => {
    // Dev bypass mode
    if (!clientId) {
      const devUser: User = { email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' };
      setUser(devUser);
      setToken(null);
      setApiToken(null);
      setIsLoading(false);
      pushAuthToExtension({
        token: null,
        email: devUser.email,
        name: devUser.name,
        expiresAt: null,
      });
      fetchAdminFlag(devUser.email);
      return;
    }

    // Wait for GIS library to load
    const initGis = () => {
      if (typeof google !== 'undefined' && google.accounts?.id) {
        google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
          auto_select: true,
        });
        google.accounts.id.prompt();
        setIsLoading(false);
      } else {
        setTimeout(initGis, 100);
      }
    };

    initGis();

    // Set up refresh callback for 401 handling
    setRefreshToken(attemptRefresh);

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [clientId, handleCredentialResponse, attemptRefresh, fetchAdminFlag]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isAdmin: !!user?.isAdmin,
        signOut,
        signInAsDev,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
