import type { SupabaseAdminClient } from './supabase';

export type AuthContext = {
  userId: string;
  email: string;
};

export function bearerToken(header: string | undefined) {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

export async function verifyJwt(admin: SupabaseAdminClient, jwt: string): Promise<AuthContext> {
  const { data, error } = await admin.auth.getUser(jwt);
  const user = data.user;
  if (error || !user) throw new Error('invalid_jwt');
  return {
    userId: user.id,
    email: user.email ?? '',
  };
}

export async function assertCompanyAccess(admin: SupabaseAdminClient, userId: string, companyId: string, adminOnly = false) {
  const { data: company } = await admin
    .from('companies')
    .select('id, owner_id')
    .eq('id', companyId)
    .maybeSingle();

  if (company && (company as { owner_id: string }).owner_id === userId) return;

  const query = admin
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId);
  const { data: member } = await query.maybeSingle();
  const role = (member as { role?: string } | null)?.role;
  if (role && (!adminOnly || role === 'admin')) return;
  throw new Error('company_access_denied');
}
