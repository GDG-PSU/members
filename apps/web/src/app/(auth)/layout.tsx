export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
