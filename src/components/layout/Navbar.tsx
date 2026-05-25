import Link from "next/link"
import { Code2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export default function Navbar() {
  return (
    <header className="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="flex items-center justify-between h-full px-6">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-7 h-7 rounded-md bg-violet-600 flex items-center justify-center">
            <Code2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-base tracking-tight">
            Code<span className="text-violet-400">Sync</span>
          </span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              Login
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-4" />
          <Link href="/register">
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
              Get Started
            </Button>
          </Link>
        </div>

      </div>
    </header>
  )
}