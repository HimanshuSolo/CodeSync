import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Analytics } from "@vercel/analytics/next"
const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "CodeSync — Collaborative AI Code Editor",
  description:
    "Real-time collaborative code editor with AI assistance. Edit together, build faster.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased min-h-screen bg-background`}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Analytics />
        </TooltipProvider>
      </body>
    </html>
  )
}