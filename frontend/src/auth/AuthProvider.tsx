import { createContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { setToken as setApiToken, setRefreshToken } from '../api/client';

export interface User {
  email: string;
  name: string;
  picture: string;
  hd: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  signOut: () => void;
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

      // Set up token refresh timer
      const exp = payload.exp as number;
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
    [],
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
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, [user]);

  useEffect(() => {
    // Dev bypass mode
    if (!clientId) {
      setUser({ email: 'dev@localhost', name: 'Dev User', picture: '', hd: '' });
      setToken(null);
      setApiToken(null);
      setIsLoading(false);
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
  }, [clientId, handleCredentialResponse, attemptRefresh]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        signOut,
        isLoading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
