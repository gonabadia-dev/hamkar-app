import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey);
export const supabase = configured ? createClient(url!, anonKey!) : null;

export type Role = 'manager' | 'employee';
export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  organization_id: string;
  manager_id: string | null;
}
export interface SignUpInput {
  role: Role;
  full_name: string;
  email: string;
  password: string;
  organization_name?: string;
  join_code?: string;
}

export function today(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function errorText(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();

  // Supabase/PostgREST errors are plain objects, not always Error instances.
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const text = (key: string) => typeof value[key] === 'string' ? (value[key] as string).trim() : '';
    const message = text('message') || text('error_description') || text('error');
    const details = text('details');
    const hint = text('hint');
    const extra = [details && details !== message ? `جزئیات: ${details}` : '',
      hint && hint !== message && hint !== details ? `راهنما: ${hint}` : ''].filter(Boolean);
    if (message) return [message, ...extra].join(' — ');
    if (details || hint) return [details, hint].filter(Boolean).join(' — ');
    const code = text('code');
    if (code) return `خطا (${code})`;
  }
  return 'خطای نامشخص؛ دوباره تلاش کنید.';
}

export async function signUpWithRole(input: SignUpInput) {
  if (!supabase) throw new Error('تنظیمات اتصال Supabase انجام نشده است.');
  const metadata = input.role === 'manager'
    ? { role: 'manager', full_name: input.full_name, organization_name: input.organization_name ?? '' }
    : { role: 'employee', full_name: input.full_name, join_code: input.join_code ?? '' };
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: metadata },
  });
  if (error) throw error;
  return data;
}
