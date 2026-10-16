import Link from "next/link";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-6 py-16">
      <div className="dot-field pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 w-full max-w-sm">
        <Link href="/" className="mb-8 inline-block text-lg">
          <Logo />
        </Link>
        {children}
      </div>
    </main>
  );
}
