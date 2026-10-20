import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from "react"
import { useAuth } from "../auth"
import { notifyIncoming, onNotificationClick, setTaskbarBadge, windowIsActive } from "../lib/desktop"
import { useReconnectEpoch } from "../lib/network"
import { readUnread, unreadTotal, writeUnread } from "../lib/unread"
import {
  blockUser,
  deleteOwnMessage,
  listBlocked,
  messagingLock,
  messagingLockMessage,
  reportMessage,
  unblockUser,
  type MessagingLock,
  type ReportReason,
} from "../lib/safety"
import {
  listChats,
  loadMessages,
  messageLabel,
  sendMessage,
  startDirectChat,
  startGroupChat,
  startLeaderChat,
  readChatPermissions,
  type ChatPermissions,
  subscribeToMessages,
  type ChatMessage,
  type ChatSummary,
} from "../lib/chats"
import { PEOPLE_FILTERS, People, matchesFilter, type PeopleFilter } from "./People"
import { LEADDESK_TABS, LeadDesk, leadDeskHints, useLeadDesk, type LeadDeskTab } from "./LeadDesk"
import { LEADERSHIP } from "../lib/leaddesk"
import { Toasts, useEventAlerts } from "./EventAlerts"
import { TIMER_RANGES, Timer, rangeTotals, useTimer, useTimerHistory, type TimerRange } from "./Timer"
import { formatDuration } from "../lib/timer"
import { isTimeZone, localTimeZone } from "../lib/timezone"
import { listUsers, readIsAdmin, type RegisteredUser } from "../lib/users"
import { PRESENCE_LABELS, usePresence } from "../lib/presence"
import { typingText, useTyping } from "../lib/typing"
import { PROFILE_TABS, Profile, type ProfileTab } from "./Profile"
import { SETTINGS_TABS, Settings, type SettingsTab } from "./Settings"
import { joinRoom, leaveRoom, listRooms, type RoomInfo } from "../lib/rooms"
import { groupTables } from "../lib/vault"
import { Vault, VaultLeaveDialog, useVault } from "./Vault"

function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.2-4.2A8 8 0 1 1 21 12z" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  )
}

function NewGroupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5v-1.2A4.3 4.3 0 0 1 7.8 14h2.4a4.3 4.3 0 0 1 4.3 4.3v1.2" />
      <circle cx="17" cy="8.5" r="2.4" />
      <path d="M16.2 14.2h.7A3.6 3.6 0 0 1 20.5 17.8V19.5" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" />
      <path d="M11.5 13.5L20 4" />
    </svg>
  )
}

function ChatsNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h8A2.5 2.5 0 0 1 17 6.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.5V6.5z" />
      <path d="M17 9h.5A2.5 2.5 0 0 1 20 11.5v8L16.5 17H11" />
    </svg>
  )
}

function RoomsNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.5 4L8 20M16 4l-1.5 16M4 9h16M3.5 15h16" />
    </svg>
  )
}

function LeadDeskNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4.5" width="16" height="16" rx="2.5" />
      <path d="M8 3v3M16 3v3M4 9.5h16M8.5 14l2 2 4-4" />
    </svg>
  )
}

function VaultNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8V7.5M12 16.5v-1.3M15.2 12h1.3M7.5 12h1.3M7 19.5v1M17 19.5v1" />
    </svg>
  )
}

function VaultTableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </svg>
  )
}

function NewTableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function DeskTasksIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
      <rect x="15.5" y="4" width="5" height="7" rx="1.5" />
    </svg>
  )
}

function DeskScheduleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

function DeskNotesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h8l4 4v11a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M14.5 3.5v4h4M8 12h8M8 16h5" />
    </svg>
  )
}

const LEADDESK_ICONS: Record<LeadDeskTab, ComponentType> = {
  tasks: DeskTasksIcon,
  schedule: DeskScheduleIcon,
  notes: DeskNotesIcon,
}

function TimerNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" />
    </svg>
  )
}

function TimerDayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  )
}

function PeopleNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4" width="17" height="16" rx="3" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
    </svg>
  )
}

function SettingsNavIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

function EditProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13" />
      <path d="M17.6 3.9a2 2 0 0 1 2.8 2.8L12.5 14.6 9 15.5l.9-3.5 7.7-8.1z" />
    </svg>
  )
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.2a5 5 0 0 1 3 4.6V20" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7M10.5 12H20M16.5 8l4 4-4 4" />
    </svg>
  )
}

type MessageAction = { label: string; danger?: boolean; onSelect: () => void }

function MessageMenu({ side, actions }: { side: "mine" | "theirs"; actions: MessageAction[] }) {
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className={`message-menu ${side}${open ? " open" : ""}`} ref={ref}>
      <button
        type="button"
        className="message-menu-button"
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          // Open upward when the message sits near the bottom of the window.
          setUpward(window.innerHeight - event.currentTarget.getBoundingClientRect().bottom < 160)
          setOpen((current) => !current)
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className={upward ? "bar-menu message-menu-list upward" : "bar-menu message-menu-list"} role="menu">
          {actions.map(({ label, danger, onSelect }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              className={danger ? "danger" : undefined}
              onClick={() => {
                setOpen(false)
                onSelect()
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Placeholder rows shown while the chat or room list loads.
function ListSkeleton() {
  return (
    <div className="list-skeleton" role="status" aria-label="Loading">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="skeleton-row">
          <span className="skeleton-avatar" />
          <span className="skeleton-lines">
            <span />
            <span />
          </span>
        </div>
      ))}
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

const PROFILE_ICONS: Record<ProfileTab, ComponentType> = {
  edit: EditProfileIcon,
  contacts: ContactsIcon,
  starred: StarIcon,
}

function AppearanceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </svg>
  )
}

function StartupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5v8" />
      <path d="M7.2 6.5a7.5 7.5 0 1 0 9.6 0" />
    </svg>
  )
}

function AboutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.6v.1" />
    </svg>
  )
}

function SafetyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5l7 2.8v5.2c0 4.4-2.9 7.8-7 9-4.1-1.2-7-4.6-7-9V6.3l7-2.8z" />
      <path d="M9 12l2.2 2.2L15.5 10" />
    </svg>
  )
}

function AllPeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="3" />
      <path d="M6.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="5" cy="10" r="2" />
      <circle cx="19" cy="10" r="2" />
      <path d="M2.5 17.5a3.5 3.5 0 0 1 3-3M21.5 17.5a3.5 3.5 0 0 0-3-3" />
    </svg>
  )
}

function LeadershipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.5 21V4M5.5 4.5h11l-2.5 4 2.5 4h-11" />
    </svg>
  )
}

function AiTrainerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 3.5l1.8 4.7 4.7 1.8-4.7 1.8L11 16.5l-1.8-4.7L4.5 10l4.7-1.8L11 3.5z" />
      <path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" />
    </svg>
  )
}

function ReviewerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.3 2.3 4.7-4.8" />
    </svg>
  )
}

function EngineerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14" />
    </svg>
  )
}

function DesignerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.6 0-1 .8-1.7 1.8-1.7h2A4 4 0 0 0 20.5 10.6C20.5 6.6 16.7 3.5 12 3.5z" />
      <circle cx="8" cy="10" r=".9" />
      <circle cx="12" cy="7.5" r=".9" />
      <circle cx="16" cy="10" r=".9" />
    </svg>
  )
}

function OperationsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" />
    </svg>
  )
}

function NoRoleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" />
      <path d="M10 9.8a2.1 2.1 0 1 1 2.8 2c-.5.2-.8.6-.8 1.2v.5M12 16.4v.1" />
    </svg>
  )
}

const PEOPLE_ICONS: Record<PeopleFilter, ComponentType> = {
  all: AllPeopleIcon,
  Leadership: LeadershipIcon,
  "AI trainer": AiTrainerIcon,
  Reviewer: ReviewerIcon,
  Engineer: EngineerIcon,
  Designer: DesignerIcon,
  Operations: OperationsIcon,
  none: NoRoleIcon,
}

const SETTINGS_ICONS: Record<SettingsTab, ComponentType> = {
  appearance: AppearanceIcon,
  startup: StartupIcon,
  about: AboutIcon,
  safety: SafetyIcon,
}

const SETTINGS_HINTS: Record<SettingsTab, string> = {
  appearance: "Light, dark, or system",
  startup: "Open when Windows starts",
  about: "Version, privacy, terms",
  safety: "Blocked people",
}

function SideMenu<T extends string>({
  label,
  items,
  active,
  onSelect,
  footer,
  plain,
}: {
  label: string
  // Items with a group are listed under a heading for it; items should come sorted by group.
  items: Array<{ id: T; label: string; hint: string; icon: ComponentType; badge?: number; group?: string }>
  active: T
  onSelect: (id: T) => void
  footer?: ReactNode
  // A compact list without lines between items or the arrow on the right, e.g. Vault tables.
  plain?: boolean
}) {
  return (
    <nav className={plain ? "side-menu side-menu-plain" : "side-menu"} aria-label={label}>
      {items.map(({ id, label: itemLabel, hint, icon: Icon, badge, group }, index) => [
        group && group !== items[index - 1]?.group && (
          <h3 key={`group-${group}`} className="side-menu-group">
            {group}
          </h3>
        ),
        <button
          key={id}
          type="button"
          className="side-menu-item"
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <span className="side-menu-icon">
            <Icon />
          </span>
          <span className="side-menu-text">
            <strong>{itemLabel}</strong>
            <span>{hint}</span>
          </span>
          {badge ? (
            <span className="unread-count" aria-label={`${badge} unread`}>
              {badge > 9 ? "9+" : badge}
            </span>
          ) : null}
          <span className="side-menu-chevron">
            <ChevronIcon />
          </span>
        </button>,
      ])}
      {footer && <div className="side-menu-footer">{footer}</div>}
    </nav>
  )
}

type NavItem = "chats" | "rooms" | "people" | "leaddesk" | "timer" | "vault" | "settings"

const NAV_ITEMS: Array<{ id: NavItem; label: string; icon: ComponentType }> = [
  { id: "chats", label: "Chats", icon: ChatsNavIcon },
  { id: "rooms", label: "Rooms", icon: RoomsNavIcon },
  { id: "people", label: "People", icon: PeopleNavIcon },
  { id: "leaddesk", label: "LeadDesk", icon: LeadDeskNavIcon },
  { id: "timer", label: "Tracker", icon: TimerNavIcon },
  { id: "vault", label: "Vault", icon: VaultNavIcon },
  { id: "settings", label: "Settings", icon: SettingsNavIcon },
]

function NavBar({
  active,
  showLeadDesk,
  badges,
  onSelect,
  footer,
}: {
  active: NavItem | null
  showLeadDesk: boolean
  badges?: Partial<Record<NavItem, number>>
  onSelect: (item: NavItem) => void
  footer?: ReactNode
}) {
  return (
    <nav className="navbar" aria-label="Sections">
      {NAV_ITEMS.filter(({ id }) => id !== "leaddesk" || showLeadDesk).map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="nav-item"
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <span className="nav-tile">
            <Icon />
            {badges?.[id] ? (
              <span className="nav-badge" aria-label={`${badges[id]} unread`}>
                {badges[id]! > 9 ? "9+" : badges[id]}
              </span>
            ) : null}
          </span>
          <span>{label}</span>
        </button>
      ))}
      {footer}
    </nav>
  )
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(mime: string | null) {
  return Boolean(mime?.startsWith("image/") && mime !== "image/svg+xml")
}

export function AppShell() {
  const { session, profile, roleChange, dismissRoleChange, signOut } = useAuth()
  const [view, setView] = useState<"chats" | "profile" | "people" | "leaddesk" | "timer" | "vault" | "settings">("chats")
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance")
  const [profileTab, setProfileTab] = useState<ProfileTab>("edit")
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all")
  const [deskTab, setDeskTab] = useState<LeadDeskTab>("tasks")
  const isLeader = profile?.role === LEADERSHIP
  // Admins get everything Leadership members have, without the limits an admin sets for them.
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    setIsAdmin(false)
    if (!session) return
    let active = true
    void readIsAdmin()
      .then((next) => {
        if (active) setIsAdmin(next)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [session?.userId])
  const hasLeadDesk = isLeader || isAdmin
  const desk = useLeadDesk(view === "leaddesk" && hasLeadDesk)
  const vault = useVault(session?.userId ?? null, view === "vault")
  // Leaving the Vault with unsaved changes first asks whether to save or discard them.
  const leaveTo = (go: () => void) => (view === "vault" ? vault.guard(go) : go())
  // Records awake and idle time in the background, whichever page is open.
  const timer = useTimer(session?.userId ?? null, isLeader)
  // Online, idle or offline for everyone, shown as a dot on profile pictures.
  const presenceOf = usePresence(session?.userId ?? null)
  const [timerRange, setTimerRange] = useState<TimerRange>("today")
  // The zone the Time Tracker counts days in; remembered on this computer.
  const [timerZone, setTimerZone] = useState(() => {
    try {
      const saved = localStorage.getItem("novaroom.timer-zone")
      return saved && isTimeZone(saved) ? saved : localTimeZone()
    } catch {
      return localTimeZone()
    }
  })
  const chooseTimerZone = (zone: string) => {
    setTimerZone(zone)
    try {
      localStorage.setItem("novaroom.timer-zone", zone)
    } catch {
      // Not remembered, but still used for this session.
    }
  }
  const timerHistory = useTimerHistory(session?.userId ?? null, view === "timer", timer.version, timer.live, timerZone)
  const alerts = useEventAlerts(session?.userId ?? null, hasLeadDesk, () => {
    if (view === "leaddesk") void desk.reload()
  })
  const refreshAlertEvents = alerts.refreshEvents
  const { unread: unreadDeskEvents, markRead: markDeskEventsRead } = alerts
  // An event stays unread, with its badges and "New" tag, until it is opened.
  const unreadEventIds = useMemo(() => new Set(unreadDeskEvents.map((event) => event.id)), [unreadDeskEvents])
  // Tasks assigned to this person by someone else stay unread until opened.
  const { unreadTasks: unreadDeskTasks, markTaskRead: markDeskTaskRead } = alerts
  const unreadTaskIds = useMemo(() => new Set(unreadDeskTasks.map((task) => task.id)), [unreadDeskTasks])

  // Edits made on LeadDesk should change start-time reminders straight away.
  useEffect(() => {
    if (desk.data) void refreshAlertEvents()
  }, [desk.data, refreshAlertEvents])

  // Leave LeadDesk if the Leadership role is removed while it is open.
  useEffect(() => {
    if (view === "leaddesk" && !hasLeadDesk) setView("chats")
  }, [view, hasLeadDesk])

  // Tell the person when an admin changes their role, as a toast and a desktop notification.
  const notify = alerts.notify
  useEffect(() => {
    if (!roleChange) return
    const { from, to } = roleChange
    if (to === LEADERSHIP) {
      notify(`role:${Date.now()}`, "You're now in Leadership", "An admin gave you the Leadership role. LeadDesk is now in the sidebar.")
    } else if (from === LEADERSHIP) {
      notify(
        `role:${Date.now()}`,
        "Leadership role removed",
        `${to ? `Your role is now ${to}. ` : ""}LeadDesk is no longer available.`,
      )
    } else {
      notify(`role:${Date.now()}`, "Your role changed", to ? `Your role is now ${to}.` : "Your role was cleared.")
    }
    dismissRoleChange()
  }, [roleChange, notify, dismissRoleChange])
  const [people, setPeople] = useState<RegisteredUser[] | null>(null)
  const [peopleError, setPeopleError] = useState("")
  const [section, setSection] = useState<"chats" | "rooms">("chats")
  const [chats, setChats] = useState<ChatSummary[]>([])
  // What an admin has allowed this person to start. Unknown (null) until loaded.
  const [chatPermissions, setChatPermissions] = useState<ChatPermissions | null>(null)
  // Leadership members and admins can always start chats and groups; everyone else needs permission.
  const canStartDirect = isLeader || isAdmin || chatPermissions?.direct === true
  const canStartGroup = isLeader || isAdmin || chatPermissions?.group === true
  // False until the first load finishes, so the sidebar shows placeholders instead of "No chats yet".
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const [roomsLoaded, setRoomsLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The conversation last opened in each section, restored when switching back to it.
  const lastOpenRef = useRef<Record<"chats" | "rooms", string | null>>({ chats: null, rooms: null })
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [email, setEmail] = useState("")
  const [groupTitle, setGroupTitle] = useState("")
  const [groupEmails, setGroupEmails] = useState("")
  const [composer, setComposer] = useState<"direct" | "group" | null>(null)
  const [body, setBody] = useState("")
  const [sendingIds, setSendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const [search, setSearch] = useState("")
  const [startError, setStartError] = useState("")
  const [sendError, setSendError] = useState("")
  const [busy, setBusy] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [blockedIds, setBlockedIds] = useState<string[]>([])
  const [lock, setLock] = useState<MessagingLock>("open")
  const [reportId, setReportId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState<ReportReason>("harassment")
  const [reportNote, setReportNote] = useState("")
  // The message last reported, so a thank-you note shows under it in the message list.
  const [reportedId, setReportedId] = useState<string | null>(null)
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  // Goes up each time the connection returns after being lost.
  const epoch = useReconnectEpoch()
  // Handles a click on a desktop notification; replaced each render so it sees the latest state.
  const notificationClickRef = useRef<(target: string) => void>(() => {})
  const selectedRef = useRef<string | null>(null)
  const blockedRef = useRef<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  selectedRef.current = selectedId
  // Which page is showing, for deciding whether a new message was actually seen.
  const viewRef = useRef(view)
  viewRef.current = view
  blockedRef.current = blockedIds

  // Refresh the user list each time the People page opens.
  useEffect(() => {
    if (view !== "people") return
    let active = true
    setPeopleError("")
    listUsers()
      .then((next) => {
        if (active) setPeople(next)
      })
      .catch((caught) => {
        if (active) setPeopleError(caught instanceof Error ? caught.message : "Could not load users.")
      })
    return () => {
      active = false
    }
  }, [view])

  // Reloaded whenever the Chats or Rooms section is opened, so a newly granted permission shows up.
  useEffect(() => {
    if (!session) return
    let active = true
    void readChatPermissions(session)
      .then((next) => {
        if (active) setChatPermissions(next)
      })
      .catch(() => {
        if (active) setChatPermissions({ direct: false, group: false })
      })
    return () => {
      active = false
    }
  }, [session, section, view])

  useEffect(() => {
    if (!session) return
    let active = true
    setRoomsLoaded(false)
    void listRooms(session)
      .then((next) => {
        if (active) setRooms(next)
      })
      .catch((caught) => {
        if (active) setStartError(caught instanceof Error ? caught.message : "Could not load rooms.")
      })
      .finally(() => {
        if (active) setRoomsLoaded(true)
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    if (!session) return
    let active = true
    setChatsLoaded(false)
    listChats(session)
      .then((next) => {
        if (active) setChats(next)
      })
      .catch((caught) => {
        if (active) {
          setStartError(caught instanceof Error ? caught.message : "Could not load chats.")
        }
      })
      .finally(() => {
        if (active) setChatsLoaded(true)
      })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    setSelectedId(null)
    setMessages([])
    if (!session) {
      setUnread({})
      void setTaskbarBadge(0)
      return
    }
    const counts = readUnread(session.userId)
    setUnread(counts)
    void setTaskbarBadge(unreadTotal(counts))
  }, [session?.userId])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      setLoadingMessages(false)
      return
    }
    let active = true
    setLoadingMessages(true)
    loadMessages(selectedId)
      .then((next) => {
        if (active) setMessages(next)
      })
      .catch((caught) => {
        if (active) {
          setSendError(caught instanceof Error ? caught.message : "Could not load messages.")
        }
      })
      .finally(() => {
        if (active) setLoadingMessages(false)
      })
    return () => {
      active = false
    }
  }, [selectedId])

  useEffect(() => {
    if (!session) return
    let active = true
    const load = () => {
      void listBlocked(session)
        .then((people) => {
          if (!active) return
          setBlockedIds(people.map((person) => person.userId))
          void listChats(session).then((next) => {
            if (active) setChats(next)
          })
          const openId = selectedRef.current
          if (!openId) return
          void loadMessages(openId).then((next) => {
            if (active && selectedRef.current === openId) setMessages(next)
          })
        })
        .catch(() => undefined)
    }
    load()
    window.addEventListener("novaroom-safety", load)
    return () => {
      active = false
      window.removeEventListener("novaroom-safety", load)
    }
  }, [session])

  useEffect(() => {
    if (!session || !selectedId) {
      setLock("open")
      return
    }
    let active = true
    void messagingLock(session, selectedId)
      .then((next) => {
        if (active) setLock(next)
      })
      .catch(() => {
        if (active) setLock("open")
      })
    return () => {
      active = false
    }
  }, [session, selectedId, blockedIds])

  useEffect(() => {
    if (!session) return
    const remember = (message: ChatMessage) => {
      setChats((current) => {
        const found = current.some((chat) => chat.id === message.conversationId)
        if (!found) {
          void listChats(session).then(setChats).catch(() => undefined)
          return current
        }
        return current
          .map((chat) => {
            if (chat.id !== message.conversationId) return chat
            if (chat.lastAt && message.createdAt < chat.lastAt) return chat
            return { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
          })
          .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""))
      })
    }
    return subscribeToMessages({
      onInsert(message) {
        if (message.senderId !== session.userId && blockedRef.current.includes(message.senderId)) return
        remember(message)
        if (message.senderId !== session.userId) {
          void windowIsActive().then((active) => {
            // Seen only if the window is in front and this chat is open on the Chats page.
            const viewing =
              active && viewRef.current === "chats" && message.conversationId === selectedRef.current
            if (viewing) return
            setUnread((current) => {
              const next = {
                ...current,
                [message.conversationId]: (current[message.conversationId] ?? 0) + 1,
              }
              writeUnread(session.userId, next)
              void setTaskbarBadge(unreadTotal(next))
              return next
            })
            void notifyIncoming(message.senderName || "Novaroom", messageLabel(message), `chat:${message.conversationId}`)
          })
        }
        setMessages((current) => {
          if (message.conversationId !== selectedRef.current) return current
          if (current.some((item) => item.id === message.id)) return current
          return [...current, message]
        })
      },
      onUpdate(message) {
        remember(message)
        setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, ...message } : item)))
      },
      onRefresh() {
        void listChats(session).then(setChats).catch(() => undefined)
        const openId = selectedRef.current
        if (!openId) return
        void loadMessages(openId).then(setMessages).catch(() => undefined)
      },
    })
  }, [session, epoch])

  // When the connection comes back, load what was missed while it was down. Requests that were
  // waiting when it dropped have failed by now, so this also ends any loading they left behind.
  useEffect(() => {
    if (!session || epoch === 0) return
    let active = true
    void listChats(session)
      .then((next) => {
        if (!active) return
        setChats(next)
        setStartError("")
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setChatsLoaded(true)
      })
    void listRooms(session)
      .then((next) => {
        if (active) setRooms(next)
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setRoomsLoaded(true)
      })
    const openId = selectedRef.current
    if (openId) {
      void loadMessages(openId)
        .then((next) => {
          if (!active || selectedRef.current !== openId) return
          setMessages(next)
          setSendError("")
        })
        .catch(() => undefined)
        .finally(() => {
          if (active && selectedRef.current === openId) setLoadingMessages(false)
        })
    }
    return () => {
      active = false
    }
  }, [session, epoch])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, selectedId])

  useEffect(() => onNotificationClick((target) => notificationClickRef.current(target)), [])

  // Who else is typing in the open chat. People this person blocked are never shown.
  const typing = useTyping(selectedId, session?.userId ?? null, profile?.displayName ?? "")
  const typingNow = typingText(typing.typists.filter((typist) => !blockedIds.includes(typist.userId)))
  if (!session || !profile) return null

  const selected = chats.find((chat) => chat.id === selectedId) ?? null
  const readable = messages.filter(
    (message) => message.senderId === session.userId || !blockedIds.includes(message.senderId),
  )
  const query = search.trim().toLowerCase()
  const visible = query
    ? readable.filter((message) => {
        const haystack = message.deleted
          ? "message deleted"
          : `${message.body} ${message.attachmentName ?? ""}`
        return haystack.toLowerCase().includes(query)
      })
    : readable
  const closed = lock !== "open"
  const reporting = visible.find((message) => message.id === reportId) ?? null

  function replaceMessage(message: ChatMessage) {
    setMessages((current) => current.map((item) => (item.id === message.id ? { ...item, ...message } : item)))
    setChats((current) =>
      current.map((chat) => {
        if (chat.id !== message.conversationId) return chat
        if (chat.lastAt && message.createdAt < chat.lastAt) return chat
        return { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
      }),
    )
  }

  async function onBlock(userId: string, block: boolean) {
    setSendError("")
    try {
      if (block) await blockUser(session!, userId)
      else await unblockUser(session!, userId)
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not update that block.")
    }
  }

  async function onDelete(message: ChatMessage) {
    if (!window.confirm("Delete this message? People in the chat will see that it was removed.")) return
    setSendError("")
    try {
      await deleteOwnMessage(session!, message.id)
      replaceMessage({
        ...message,
        deleted: true,
        body: "",
        attachmentUrl: null,
        attachmentName: null,
        attachmentMime: null,
        attachmentSize: null,
      })
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not delete that message.")
    }
  }

  async function onReport() {
    if (!reporting) return
    setSendError("")
    setReportedId(null)
    try {
      await reportMessage(session!, reporting, reportReason, reportNote)
      setReportedId(reporting.id)
      setReportId(null)
      setReportNote("")
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not send that report.")
    }
  }

  async function onJoin(roomId: string) {
    setStartError("")
    setBusy(true)
    try {
      await joinRoom(session!, roomId)
      const [nextChats, nextRooms] = await Promise.all([listChats(session!), listRooms(session!)])
      setChats(nextChats)
      setRooms(nextRooms)
      selectConversation(roomId)
      setView("chats")
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not join that room.")
    } finally {
      setBusy(false)
    }
  }

  async function onLeave(roomId: string) {
    setSendError("")
    try {
      await leaveRoom(session!, roomId)
      if (selectedId === roomId) {
        setSelectedId(null)
        setMessages([])
      }
      const [nextChats, nextRooms] = await Promise.all([listChats(session!), listRooms(session!)])
      setChats(nextChats)
      setRooms(nextRooms)
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Could not leave that room.")
    }
  }

  async function onStart(event: FormEvent) {
    event.preventDefault()
    setStartError("")
    setBusy(true)
    try {
      const id = await startDirectChat(session!, email)
      setChats(await listChats(session!))
      selectConversation(id)
      setView("chats")
      setEmail("")
      setComposer(null)
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not start that chat.")
    } finally {
      setBusy(false)
    }
  }

  async function onGroup(event: FormEvent) {
    event.preventDefault()
    setStartError("")
    setBusy(true)
    try {
      const id = await startGroupChat(session!, groupTitle, groupEmails)
      setChats(await listChats(session!))
      selectConversation(id)
      setView("chats")
      setGroupTitle("")
      setGroupEmails("")
      setComposer(null)
      setSearch("")
    } catch (caught) {
      setStartError(caught instanceof Error ? caught.message : "Could not create that group.")
    } finally {
      setBusy(false)
    }
  }

  async function onSend(event: FormEvent) {
    typing.onType(false)
    event.preventDefault()
    if (!selectedId || lock !== "open") return
    const text = body
    if (!text.trim()) return
    markChatRead(selectedId)
    setBody("")
    setSendError("")

    // Show the message right away, then swap in the saved copy once the server confirms it.
    const localId = `local-${crypto.randomUUID()}`
    const draft: ChatMessage = {
      id: localId,
      conversationId: selectedId,
      senderId: session!.userId,
      senderName: profile?.displayName || session!.email,
      body: text.trim(),
      createdAt: new Date().toISOString(),
      deleted: false,
      attachmentUrl: null,
      attachmentName: null,
      attachmentMime: null,
      attachmentSize: null,
    }
    setMessages((current) => [...current, draft])
    setSendingIds((current) => new Set(current).add(localId))

    try {
      const message = await sendMessage(session!, selectedId, text)
      setMessages((current) => {
        // Realtime may have delivered the saved message before this resolved.
        const withoutDraft = current.filter((item) => item.id !== localId)
        if (withoutDraft.some((item) => item.id === message.id)) return withoutDraft
        return current.map((item) => (item.id === localId ? message : item))
      })
      setChats((current) =>
        current
          .map((chat) =>
            chat.id === message.conversationId
              ? { ...chat, lastBody: messageLabel(message), lastAt: message.createdAt }
              : chat,
          )
          .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
      )
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== localId))
      setBody(text)
      setSendError(caught instanceof Error ? caught.message : "Could not send that message.")
    } finally {
      setSendingIds((current) => {
        const next = new Set(current)
        next.delete(localId)
        return next
      })
    }
  }

  // Grow the message box with its content, from one line up to a few, then scroll.
  useEffect(() => {
    const box = bodyRef.current
    if (!box) return
    box.style.height = "auto"
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`
  }, [body, selectedId])

  const conversations = chats.filter((chat) => chat.kind !== "room")
  // Unread messages per navbar section, counting only conversations this person is still in.
  const unreadChats = conversations.reduce((sum, chat) => sum + (unread[chat.id] > 0 ? unread[chat.id] : 0), 0)
  const unreadRooms = chats
    .filter((chat) => chat.kind === "room")
    .reduce((sum, chat) => sum + (unread[chat.id] > 0 ? unread[chat.id] : 0), 0)
  const contacts = chats.filter((chat) => chat.kind === "direct" && chat.otherUserId)
  const profileHints: Record<ProfileTab, string> = {
    edit: "Name, status, avatar",
    contacts: `${contacts.length} known`,
    starred: "None saved yet",
  }

  // Shows a conversation. Messages load when the selection changes, so re-selecting the chat that
  // is already open must not clear it and wait for a load that will never come.
  function selectConversation(chatId: string) {
    if (chatId === selectedId) return
    setLoadingMessages(true)
    setMessages([])
    setSelectedId(chatId)
  }

  // Clears a chat's unread count. An open chat keeps its badge after messages arrive in the
  // background until the person clicks it, types in it or sends a message.
  function markChatRead(chatId: string) {
    setUnread((current) => {
      if (!current[chatId]) return current
      const next = { ...current, [chatId]: 0 }
      writeUnread(session!.userId, next)
      void setTaskbarBadge(unreadTotal(next))
      return next
    })
  }

  function openChat(chatId: string) {
    const kind = chats.find((chat) => chat.id === chatId)?.kind
    if (kind) lastOpenRef.current[kind === "room" ? "rooms" : "chats"] = chatId
    selectConversation(chatId)
    setView("chats")
    setSearch("")
    markChatRead(chatId)
  }

  // Clicking a desktop notification opens what it was about: the chat a message came from, or the
  // LeadDesk tab for a task or event.
  notificationClickRef.current = (target) => {
    const [kind, id] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)]
    if (kind === "chat" && id) {
      leaveTo(() => {
        const chat = chats.find((item) => item.id === id)
        setSection(chat?.kind === "room" ? "rooms" : "chats")
        setComposer(null)
        setStartError("")
        openChat(id)
      })
    } else if (kind === "desk" && hasLeadDesk && (id === "tasks" || id === "schedule")) {
      leaveTo(() => {
        setDeskTab(id)
        setView("leaddesk")
      })
    }
  }

  function selectNav(item: NavItem) {
    if (item === "settings" || item === "people" || item === "leaddesk" || item === "timer" || item === "vault") {
      // Clicking the page that is already open takes it back to its first tab.
      if (item === view) {
        if (item === "settings") setSettingsTab("appearance")
        if (item === "people") setPeopleFilter("all")
        if (item === "leaddesk") setDeskTab("tasks")
        if (item === "timer") setTimerRange("today")
      }
      setView(item)
      return
    }
    setSection(item)
    setView("chats")
    setComposer(null)
    setStartError("")
    const current = chats.find((chat) => chat.id === selectedId)
    if (current) lastOpenRef.current[current.kind === "room" ? "rooms" : "chats"] = current.id
    if (current && (current.kind === "room") === (item === "rooms")) return
    const restore = chats.find((chat) => chat.id === lastOpenRef.current[item])
    if (restore) {
      openChat(restore.id)
    } else {
      setSelectedId(null)
      setMessages([])
    }
  }

  return (
    <div className="shell">
      <NavBar
        active={
          view === "settings" || view === "people" || view === "leaddesk" || view === "timer" || view === "vault"
            ? view
            : view === "profile"
              ? null
              : section
        }
        showLeadDesk={hasLeadDesk}
        badges={{
          chats: unreadChats,
          rooms: unreadRooms,
          leaddesk: unreadDeskEvents.length + unreadDeskTasks.length,
        }}
        onSelect={(item) => {
          if (item === "vault" && view === "vault") {
            vault.selectTable(vault.data?.tables[0]?.id ?? null)
            return
          }
          leaveTo(() => selectNav(item))
        }}
        footer={
          <button
            type="button"
            className="nav-profile"
            aria-current={view === "profile" ? "page" : undefined}
            aria-label="Your profile"
            title={profile.displayName || session.email}
            onClick={() => {
              if (view === "profile") setProfileTab("edit")
              leaveTo(() => setView("profile"))
            }}
          >
            <span className="avatar">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" />
              ) : (
                <span>{initials(profile.displayName || session.email)}</span>
              )}
            </span>
            <span
              className={`presence-dot nav-presence ${presenceOf(session.userId)}`}
              title={PRESENCE_LABELS[presenceOf(session.userId)]}
            />
          </button>
        }
      />
      <aside className="rail">
        {view === "timer" ? (
          <SideMenu
            label="Time ranges"
            items={TIMER_RANGES.map(({ id, label }) => ({
              id,
              label,
              hint: timerHistory.rows
                ? `${formatDuration(rangeTotals(id, timerHistory.rows, timerZone).awake)} online`
                : "Loading…",
              icon: TimerDayIcon,
            }))}
            active={timerRange}
            onSelect={setTimerRange}
          />
        ) : view === "leaddesk" ? (
          <SideMenu
            label="LeadDesk sections"
            items={LEADDESK_TABS.map(({ id, label }) => ({
              id,
              label,
              hint: leadDeskHints(desk.data, session.userId, isAdmin)[id],
              icon: LEADDESK_ICONS[id],
              badge:
                id === "schedule" ? unreadDeskEvents.length : id === "tasks" ? unreadDeskTasks.length : undefined,
            }))}
            active={deskTab}
            onSelect={setDeskTab}
          />
        ) : view === "people" ? (
          <SideMenu
            label="Roles"
            items={PEOPLE_FILTERS.map(({ id, label }) => {
              const count = people?.filter((user) => matchesFilter(user, id)).length
              return {
                id,
                label,
                hint: count === undefined ? "Loading…" : count === 1 ? "1 person" : `${count} people`,
                icon: PEOPLE_ICONS[id] ?? NoRoleIcon,
              }
            })}
            active={peopleFilter}
            onSelect={setPeopleFilter}
          />
        ) : view === "vault" ? (
          <SideMenu
            label="Vault tables"
            plain
            items={groupTables(vault.data?.tables ?? []).flatMap(({ category, tables }) =>
              tables.map((table) => ({
                id: table.id,
                label: table.name || "Untitled",
                hint: table.rows.length === 1 ? "1 row" : `${table.rows.length} rows`,
                icon: VaultTableIcon,
                group: category,
              })),
            )}
            active={vault.table?.id ?? ""}
            onSelect={vault.selectTable}
            footer={
              vault.data && vault.editing ? (
                <button type="button" className="side-menu-item" onClick={vault.addTable}>
                  <span className="side-menu-icon">
                    <NewTableIcon />
                  </span>
                  <span className="side-menu-text">
                    <strong>New table</strong>
                    <span>Add a table to this Vault</span>
                  </span>
                </button>
              ) : undefined
            }
          />
        ) : view === "settings" ? (
          <SideMenu
            label="Settings sections"
            items={SETTINGS_TABS.map(({ id, label }) => ({
              id,
              label,
              hint: SETTINGS_HINTS[id],
              icon: SETTINGS_ICONS[id],
            }))}
            active={settingsTab}
            onSelect={setSettingsTab}
          />
        ) : view === "profile" ? (
          <SideMenu
            label="Profile sections"
            items={PROFILE_TABS.map(({ id, label }) => ({
              id,
              label,
              hint: profileHints[id],
              icon: PROFILE_ICONS[id],
            }))}
            active={profileTab}
            onSelect={setProfileTab}
            footer={
              <button type="button" className="side-menu-item sign-out" onClick={() => void signOut()}>
                <span className="side-menu-icon">
                  <SignOutIcon />
                </span>
                <span className="side-menu-text">
                  <strong>Sign out</strong>
                  <span>{session.email}</span>
                </span>
              </button>
            }
          />
        ) : (
          <>
        <div className="rail-head">
          <p className="list-label">{section === "chats" ? "Chats" : "Rooms"}</p>
          {section === "chats" && (
            <div className="rail-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="New chat"
                title={canStartDirect ? "New chat" : "You need an admin's permission to start new chats"}
                aria-pressed={composer === "direct"}
                disabled={busy || !canStartDirect}
                onClick={() => {
                  setStartError("")
                  setComposer((current) => (current === "direct" ? null : "direct"))
                }}
              >
                <NewChatIcon />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="New group"
                title={canStartGroup ? "New group" : "You need an admin's permission to start groups"}
                aria-pressed={composer === "group"}
                disabled={busy || !canStartGroup}
                onClick={() => {
                  setStartError("")
                  setComposer((current) => (current === "group" ? null : "group"))
                }}
              >
                <NewGroupIcon />
              </button>
            </div>
          )}
        </div>
        {composer === "direct" && (
          <form className="new-chat" onSubmit={onStart}>
            <label>
              New chat
              <input
                type="email"
                value={email}
                placeholder="Enter their email to start a chat"
                onChange={(event) => setEmail(event.target.value)}
                autoFocus
                required
              />
            </label>
            <div className="new-chat-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setComposer(null)
                  setStartError("")
                }}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={busy}>
                {busy ? "Starting…" : "Start chat"}
              </button>
            </div>
            {startError && (
              <p className="form-error" role="alert">
                {startError}
              </p>
            )}
          </form>
        )}
        {composer === "group" && (
          <form className="new-chat" onSubmit={onGroup}>
            <label>
              New group
              <input
                value={groupTitle}
                maxLength={80}
                placeholder="Group name"
                onChange={(event) => setGroupTitle(event.target.value)}
                autoFocus
                required
              />
            </label>
            <label>
              People
              <textarea
                value={groupEmails}
                rows={2}
                placeholder="Emails, separated by commas"
                onChange={(event) => setGroupEmails(event.target.value)}
                required
              />
            </label>
            <div className="new-chat-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setComposer(null)
                  setStartError("")
                }}
              >
                Cancel
              </button>
              <button type="submit" className="button" disabled={busy}>
                {busy ? "Starting…" : "Create group"}
              </button>
            </div>
            {startError && (
              <p className="form-error" role="alert">
                {startError}
              </p>
            )}
          </form>
        )}
        <div className="chat-list">
          {section === "chats" && !chatsLoaded && <ListSkeleton />}
          {section === "chats" && chatsLoaded && (conversations.length === 0 ? (
            <p className="empty-list">No chats yet. Start a direct chat or a group.</p>
          ) : (
            conversations.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={chat.id === selectedId ? "chat-row active" : "chat-row"}
                onClick={() => openChat(chat.id)}
              >
                <span className="avatar">
                  {chat.avatarUrl ? (
                    <img src={chat.avatarUrl} alt="" />
                  ) : (
                    <span>{initials(chat.title)}</span>
                  )}
                </span>
                <span className="profile-chip-text">
                  <strong>{chat.title}</strong>
                  <span>{chat.lastBody || "No messages yet"}</span>
                </span>
                {unread[chat.id] > 0 && (
                  <span className="unread-count">{unread[chat.id] > 9 ? "9+" : unread[chat.id]}</span>
                )}
              </button>
            ))
          ))}
          {section === "rooms" && !roomsLoaded && <ListSkeleton />}
          {section === "rooms" && roomsLoaded && (rooms.length === 0 ? (
            <p className="empty-list">Topic rooms appear after the rooms SQL script is run.</p>
          ) : (
            rooms.map((room) => {
              const chat = chats.find((item) => item.id === room.id)
              if (room.joined && chat) {
                return (
                  <button
                    key={room.id}
                    type="button"
                    className={room.id === selectedId ? "chat-row active" : "chat-row"}
                    onClick={() => openChat(room.id)}
                  >
                    <span className="avatar">
                      <span>{initials(room.title)}</span>
                    </span>
                    <span className="profile-chip-text">
                      <strong>{room.title}</strong>
                      <span>{chat.lastBody || room.description}</span>
                    </span>
                    {unread[room.id] > 0 && (
                      <span className="unread-count">{unread[room.id] > 9 ? "9+" : unread[room.id]}</span>
                    )}
                  </button>
                )
              }
              return (
                <div className="room-row" key={room.id}>
                  <span className="profile-chip-text">
                    <strong>{room.title}</strong>
                    <span>{room.description}</span>
                  </span>
                  <button type="button" className="button" disabled={busy} onClick={() => void onJoin(room.id)}>
                    Join
                  </button>
                </div>
              )
            })
          ))}
        </div>
          </>
        )}
      </aside>
      {view === "timer" ? (
        <Timer
          range={timerRange}
          zone={timerZone}
          onZoneChange={chooseTimerZone}
          enabled={timer.enabled}
          isLeader={isLeader}
          optedIn={timer.optedIn}
          onToggle={timer.setEnabled}
          todaySegments={timerHistory.todaySegments}
          rows={timerHistory.rows}
          error={timerHistory.error}
        />
      ) : view === "leaddesk" ? (
        <LeadDesk
          tab={deskTab}
          data={desk.data}
          error={desk.error}
          reload={desk.reload}
          newEventIds={unreadEventIds}
          onEventOpened={(id) => markDeskEventsRead([id])}
          newTaskIds={unreadTaskIds}
          onTaskOpened={markDeskTaskRead}
          isAdmin={isAdmin}
        />
      ) : view === "people" ? (
        <People
          users={people}
          error={peopleError}
          filter={peopleFilter}
          canMessageLeaders={isLeader}
          presenceOf={presenceOf}
          onMessage={async (userId) => {
            const id = await startLeaderChat(session, userId)
            setChats(await listChats(session))
            setSection("chats")
            setComposer(null)
            selectConversation(id)
            setSearch("")
            setView("chats")
          }}
        />
      ) : view === "vault" ? (
        <Vault vault={vault} />
      ) : view === "settings" ? (
        <Settings tab={settingsTab} />
      ) : view === "profile" ? (
        <Profile
          tab={profileTab}
          contacts={contacts}
          chatCount={conversations.length}
          onBack={() => setView("chats")}
          onSelectTab={setProfileTab}
          onOpenChat={(chatId) => {
            setSection("chats")
            openChat(chatId)
          }}
        />
      ) : (
        <section className="thread">
          <header className="thread-bar">
            <div>
              <h1>{selected ? selected.title : "Messages"}</h1>
              {selected?.detail && <p className="thread-email">{selected.detail}</p>}
            </div>
            {selected && (
              <div className="thread-actions">
                {selected.kind === "direct" && selected.otherUserId && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      void onBlock(selected.otherUserId!, !blockedIds.includes(selected.otherUserId!))
                    }}
                  >
                    {blockedIds.includes(selected.otherUserId) ? "Unblock" : "Block"}
                  </button>
                )}
                {selected.kind === "room" && (
                  <button type="button" className="button secondary" onClick={() => void onLeave(selected.id)}>
                    Leave
                  </button>
                )}
                <input
                  className="search"
                  value={search}
                  placeholder="Search this chat"
                  aria-label="Search this chat"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            )}
          </header>
          {selected ? (
            <>
              <div className="message-log" ref={logRef}>
                {loadingMessages ? (
                  <div className="thread-loading" role="status" aria-label="Loading messages">
                    <span className="loading-spinner" aria-hidden="true" />
                  </div>
                ) : visible.length === 0 ? (
                  <p className="thread-note thread-empty-note">
                    {query ? "No messages match that search." : "No messages yet. Say hello."}
                  </p>
                ) : (
                  visible.map((message) => {
                    const mine = message.senderId === session.userId
                    const name = mine ? profile.displayName || session.email : message.senderName
                    const avatarUrl = mine ? profile.avatarUrl : message.senderAvatarUrl
                    const avatar = (
                      <span className="avatar message-avatar" title={name}>
                        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials(name)}</span>}
                      </span>
                    )
                    return (
                      <Fragment key={message.id}>
                        <div className={mine ? "message-row mine" : "message-row theirs"}>
                          {!mine && avatar}
                          <article className={mine ? "bubble mine" : "bubble theirs"}>
                            {(selected.kind === "group" || selected.kind === "room") &&
                              message.senderId !== session.userId && <p className="sender-name">{message.senderName}</p>}
                            {message.attachmentUrl && isImage(message.attachmentMime) && (
                              <img
                                className="bubble-image"
                                src={message.attachmentUrl}
                                alt={message.attachmentName ?? "Image"}
                              />
                            )}
                            {message.attachmentUrl && !isImage(message.attachmentMime) && (
                              <a
                                className="file-link"
                                href={message.attachmentUrl}
                                download={message.attachmentName ?? undefined}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {message.attachmentName ?? "File"}
                                {message.attachmentSize != null ? ` (${formatBytes(message.attachmentSize)})` : ""}
                              </a>
                            )}
                            {message.body && <p>{message.body}</p>}
                            {message.deleted && <p className="deleted-note">Message deleted</p>}
                            <span className="bubble-meta">
                              <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                              {message.senderId === session.userId &&
                                (sendingIds.has(message.id) ? (
                                  <span className="bubble-status sending" role="img" aria-label="Sending" />
                                ) : (
                                  <svg className="bubble-status" viewBox="0 0 16 16" role="img" aria-label="Sent">
                                    <path d="M3 8.5l3 3 7-7" />
                                  </svg>
                                ))}
                            </span>
                            {!message.deleted && !sendingIds.has(message.id) && (
                              <MessageMenu
                                side={message.senderId === session.userId ? "mine" : "theirs"}
                                actions={
                                  message.senderId === session.userId
                                    ? [{ label: "Delete", danger: true, onSelect: () => void onDelete(message) }]
                                    : [
                                        {
                                          label: "Report",
                                          danger: true,
                                          onSelect: () => {
                                            setReportedId(null)
                                            setReportId(message.id)
                                            setReportReason("harassment")
                                            setReportNote("")
                                          },
                                        },
                                        ...(selected.kind === "group" && !blockedIds.includes(message.senderId)
                                          ? [{ label: "Block", onSelect: () => void onBlock(message.senderId, true) }]
                                          : []),
                                      ]
                                }
                              />
                            )}
                          </article>
                          {mine && avatar}
                        </div>
                        {message.id === reportedId && (
                          <p className="message-system-note" role="status">
                            Report sent. Thank you.
                          </p>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </div>
              {/* Always there, so the composer does not jump when someone starts or stops typing. */}
              <p className="typing-status" aria-live="polite">
                {typingNow && (
                  <>
                    <span className="typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    {typingNow}…
                  </>
                )}
              </p>
              <form className="composer" onSubmit={onSend}>
                {closed && (
                  <p className="notice" role="status">
                    {messagingLockMessage(lock)}
                  </p>
                )}
                {reporting && (
                  <div className="report-box">
                    <label>
                      Report this message
                      <select
                        value={reportReason}
                        onChange={(event) => setReportReason(event.target.value as ReportReason)}
                      >
                        <option value="harassment">Harassment</option>
                        <option value="spam">Spam</option>
                        <option value="leak">Confidential client information</option>
                        <option value="other">Something else</option>
                      </select>
                    </label>
                    <label>
                      Note, optional
                      <textarea
                        value={reportNote}
                        maxLength={1000}
                        rows={2}
                        onChange={(event) => setReportNote(event.target.value)}
                      />
                    </label>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          setReportId(null)
                          setReportNote("")
                        }}
                      >
                        Cancel
                      </button>
                      <button type="button" className="button" onClick={() => void onReport()}>
                        Send report
                      </button>
                    </div>
                  </div>
                )}
                {sendError && (
                  <p className="form-error" role="alert">
                    {sendError}
                  </p>
                )}
                <div className="composer-row">
                  <textarea
                    ref={bodyRef}
                    value={body}
                    maxLength={4000}
                    rows={1}
                    placeholder="Write a message"
                    aria-label="Message"
                    disabled={closed}
                    onChange={(event) => {
                      setBody(event.target.value)
                      typing.onType(event.target.value.trim() !== "")
                      if (selectedId) markChatRead(selectedId)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="button send-button"
                    aria-label="Send"
                    disabled={closed || !body.trim()}
                  >
                    <SendIcon />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="thread-empty">
              <h2>No conversation selected</h2>
              <p>Start a direct chat or a group, or pick one from the list.</p>
            </div>
          )}
        </section>
      )}
      <Toasts
        toasts={alerts.toasts}
        onDismiss={alerts.dismiss}
        onOpen={(toast) => {
          if (!hasLeadDesk) return
          leaveTo(() => {
            setDeskTab(toast.tab)
            setView("leaddesk")
          })
        }}
      />
      <VaultLeaveDialog vault={vault} />
    </div>
  )
}
