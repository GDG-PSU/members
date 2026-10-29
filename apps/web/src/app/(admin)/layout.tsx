import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/viewer';
import { AdminNav } from '@/components/admin/admin-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireAdmin();
  const { data: assurance } = await viewer.supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (assurance?.currentLevel !== 'aal2') {
    redirect('/admin-mfa');
  }

  return (
    <main id="main">
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
        <AdminNav />
      </div>
      {children}
    </main>
  );
}
