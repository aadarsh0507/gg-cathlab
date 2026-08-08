import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient, clearToken, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import type { AuthResponse, PermissionMatrix, Screen, User } from '../types';

type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  can: (screen: Screen, action: PermissionAction) => boolean;
  canView: (screen: Screen) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function decodeUserFromToken(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.id,
      username: payload.username,
      full_name: payload.full_name,
      role_id: payload.role_id,
      role_name: payload.role_name,
      permissions: payload.permissions as PermissionMatrix,
      is_active: true,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (token) {
      setUser(decodeUserFromToken(token));
    }
    setIsLoading(false);

    setUnauthorizedHandler(() => {
      setUser(null);
    });
  }, []);

  const login = async (username: string, password: string) => {
    const { data } = await apiClient.post<AuthResponse>('/auth/login', { username, password });
    setToken(data.token);
    setUser(data.user);
  };

  const logout = () => {
    clearToken();
    setUser(null);
  };

  const can = (screen: Screen, action: PermissionAction): boolean => {
    return !!user?.permissions?.[screen]?.[`can_${action}`];
  };

  const canView = (screen: Screen) => can(screen, 'view');

  const value = useMemo(() => ({ user, isLoading, login, logout, can, canView }), [user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
