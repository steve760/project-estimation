import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../types/database';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  consultantId: string | null;
  refetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchCurrentConsultant(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('consultants')
    .select('id, role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return { id: data.id, role: data.role as 'admin' | 'user', consultant_id: data.id };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const refetchProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    const p = await fetchCurrentConsultant(user.id);
    setProfile(p);
    setProfileLoading(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 5000);

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!cancelled) {
          setSession(session);
          const u = session?.user ?? null;
          setUser(u);
          if (!u) {
            setProfile(null);
            setProfileLoading(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
          setUser(null);
          setProfile(null);
          setProfileLoading(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          clearTimeout(timeout);
          setLoading(false);
        }
      });

    const {
      data: { subscription },
    } =     supabase.auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setSession(session);
        const u = session?.user ?? null;
        setUser(u);
        if (!u) {
          setProfile(null);
          setProfileLoading(false);
        }
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start loading before async fetch
    setProfileLoading(true);
    fetchCurrentConsultant(user.id).then((p) => {
      if (!cancelled) {
        setProfile(p);
        setProfileLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const isAdmin = profile?.role === 'admin';
  const consultantId = profile?.consultant_id ?? null;

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, profileLoading, signIn, signUp, signOut, isAdmin, consultantId, refetchProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook exported for components; React Refresh expects only components in this file
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
