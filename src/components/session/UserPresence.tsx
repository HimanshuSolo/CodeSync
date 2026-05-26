"use client"

import { Crown, Wifi, WifiOff } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { Participant } from "@/types"

const MOCK_PARTICIPANTS: Participant[] = [
  {
    userId:      "u1",
    username:    "himanshu",
    avatarColor: "#7c3aed",
    cursorLine:  12,
    cursorCol:   8,
    isOnline:    true,
  },
  {
    userId:      "u2",
    username:    "priya",
    avatarColor: "#0891b2",
    cursorLine:  34,
    cursorCol:   22,
    isOnline:    true,
  },
  {
    userId:      "u3",
    username:    "rahul",
    avatarColor: "#059669",
    cursorLine:  0,
    cursorCol:   0,
    isOnline:    false,
  },
]

const CURRENT_USER_ID = "u1"

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// ── single user row ──
function UserRow({ participant, isOwner }: {
  participant: Participant
  isOwner: boolean
}) {
  const isMe = participant.userId === CURRENT_USER_ID

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors">

      <div className="relative flex-shrink-0">
        <Avatar className="w-7 h-7">
          <AvatarFallback
            className="text-xs font-bold text-white"
            style={{ backgroundColor: participant.avatarColor }}
          >
            {getInitials(participant.username)}
          </AvatarFallback>
        </Avatar>
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background ${
          participant.isOnline ? "bg-green-500" : "bg-zinc-600"
        }`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">
            {participant.username}
            {isMe && (
              <span className="text-muted-foreground font-normal"> (you)</span>
            )}
          </span>
          {isOwner && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Crown className="w-3 h-3 text-yellow-500 flex-shrink-0" />
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="text-xs">Session owner</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {participant.isOnline && (
          <p className="text-xs text-muted-foreground font-mono">
            Ln {participant.cursorLine}, Col {participant.cursorCol}
          </p>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex-shrink-0">
            {participant.isOnline
              ? <Wifi    className="w-3 h-3 text-green-500" />
              : <WifiOff className="w-3 h-3 text-muted-foreground" />
            }
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p className="text-xs">
            {participant.isOnline ? "Online" : "Offline"}
          </p>
        </TooltipContent>
      </Tooltip>

    </div>
  )
}

export default function UserPresence({ ownerId = "u1" }: { ownerId?: string }) {
  const online  = MOCK_PARTICIPANTS.filter((p) => p.isOnline)
  const offline = MOCK_PARTICIPANTS.filter((p) => !p.isOnline)

  return (
    <div className="flex flex-col gap-1">

      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Participants
        </span>
        <Badge
          variant="outline"
          className="text-xs h-5 px-1.5 bg-green-950 text-green-400 border-green-900"
        >
          {online.length} online
        </Badge>
      </div>

      <div className="flex flex-col gap-0.5">
        {online.map((p) => (
          <UserRow
            key={p.userId}
            participant={p}
            isOwner={p.userId === ownerId}
          />
        ))}
      </div>

      {offline.length > 0 && (
        <>
          <Separator className="my-1 bg-border/50" />
          <div className="flex flex-col gap-0.5 opacity-60">
            {offline.map((p) => (
              <UserRow
                key={p.userId}
                participant={p}
                isOwner={p.userId === ownerId}
              />
            ))}
          </div>
        </>
      )}

    </div>
  )
}