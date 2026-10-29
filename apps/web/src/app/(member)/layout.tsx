import { MemberNav } from '@/components/member/member-nav';

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main">
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
        <MemberNav />
      </div>
      {children}
    </main>
  );
}
