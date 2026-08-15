import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blockout — конструктор локаций",
  description: "Локальный инструмент для проектирования игровых уровней на сетке.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
