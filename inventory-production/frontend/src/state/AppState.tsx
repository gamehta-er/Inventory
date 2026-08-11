import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { AppSession, AuthState, Lookups, Profile, UserSummary } from '../types';

interface Toast { id: number; tone: 'success' | 'error' | 'info'; message: string }
interface AppStateValue {
  auth: AuthState | null;
  directory: UserSummary[];
  session: AppSession | null;
  lookups: Lookups | null;
  profiles: Record<number, Profile>;
  inventoryRevision: number;
  loading: boolean;
  fatalError: string;
  toasts: Toast[];
  login(userId: number): Promise<void>;
  logout(): Promise<void>;
  refreshSession(): Promise<void>;
  refreshRegistry(): Promise<void>;
  invalidateInventory(): void;
  getProfile(profileId: number, force?: boolean): Promise<Profile>;
  notify(message: string, tone?: Toast['tone']): void;
}

const StateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [directory, setDirectory] = useState<UserSummary[]>([]);
  const [session, setSession] = useState<AppSession | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [profiles, setProfiles] = useState<Record<number, Profile>>({});
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  }, []);

  const refreshSession = useCallback(async () => {
    const [nextSession, nextLookups] = await Promise.all([api.session(), api.lookups()]);
    setSession(nextSession); setLookups(nextLookups);
  }, []);

  const refreshRegistry = useCallback(async () => {
    setProfiles({});
    await refreshSession();
  }, [refreshSession]);

  const invalidateInventory = useCallback(() => {
    setInventoryRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.users(), api.authSession(), api.version()])
      .then(async ([users, authState, version]) => {
        if (!active) return;
        if (!version.compatible
          || version.webVersion !== __INVENTORY_WEB_VERSION__
          || version.apiVersion !== version.packageVersion
          || version.webVersion !== version.packageVersion) {
          throw new Error(`Inventory Project components are not compatible. Web ${__INVENTORY_WEB_VERSION__}, API ${version.apiVersion}, package ${version.packageVersion}.`);
        }
        setDirectory(users); setAuth(authState);
        if (authState.authenticated) await refreshSession();
      })
      .catch((error: Error) => active && setFatalError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [refreshSession]);

  const login = useCallback(async (userId: number) => {
    await api.login(userId);
    const authState = await api.authSession(); setAuth(authState); await refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    await api.logout(); setAuth({ authenticated: false, user: null }); setSession(null); setLookups(null); setProfiles({});
  }, []);

  const getProfile = useCallback(async (profileId: number, force = false) => {
    if (!force && profiles[profileId]) return profiles[profileId];
    const profile = await api.profile(profileId); setProfiles((current) => ({ ...current, [profileId]: profile })); return profile;
  }, [profiles]);

  const value = useMemo(() => ({ auth, directory, session, lookups, profiles, inventoryRevision, loading, fatalError, toasts, login, logout, refreshSession, refreshRegistry, invalidateInventory, getProfile, notify }), [auth, directory, session, lookups, profiles, inventoryRevision, loading, fatalError, toasts, login, logout, refreshSession, refreshRegistry, invalidateInventory, getProfile, notify]);
  return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const state = useContext(StateContext); if (!state) throw new Error('App state is unavailable.'); return state;
}
