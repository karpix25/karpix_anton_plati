import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Контент машина | AI Avatar Workspace",
  description: "Для ИИ аватаров с B-roll — генератор рекламного контента",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <QueryProvider>
          {children}
          <Toaster position="top-right" expand={false} richColors />
        </QueryProvider>
      </body>
    </html>
  );
}
