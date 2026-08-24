import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QuotationOps",
  description: "AI-assisted takeoff and quotation estimation for windows and doors"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
