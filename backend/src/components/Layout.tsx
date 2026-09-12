import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { SupportChatWidget } from "@/components/SupportChatWidget";

type LayoutProps = {
  children: React.ReactNode;
};

export function Layout({ children }: LayoutProps) {
  return (
    <div className="app-shell flex min-h-screen flex-col">
      <Header />
      <main className="app-container flex-1 py-8">
        {children}
      </main>
      <Footer />
      <SupportChatWidget />
      <CookieBanner />
    </div>
  );
}
