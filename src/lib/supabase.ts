import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// Avoid Supabase throwing "supabaseUrl is required" when env vars are missing (e.g. Vercel not configured).
// Use a placeholder so the app loads and the login page can display; auth and data will fail until env is set.
const url = supabaseUrl || 'https://placeholder.supabase.co';
const key = supabaseAnonKey || 'placeholder-anon-key';

export const supabase = createClient(url, key);

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
