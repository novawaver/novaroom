import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { emptyProfile, type Profile, type Session } from "./types"
import { isSupabaseConfigured, supabase } from "./lib/supabase"
import { PREVIEW_CODE, PREVIEW_PROFILES_KEY, PREVIEW_SESSION_KEY, previewUserId } from "./lib/preview"
import { deletePreviewAccount, safetyError } from "./lib/safety"
import { writeUnread } from "./lib/unread"

const SESSION_KEY = PREVIEW_SESSION_KEY
const PROFILES_KEY = PREVIEW_PROFILES_KEY
// The last role this computer saw for each account, so a change made while the app was closed is
// still announced on the next start.
const ROLE_KEY = (userId: string) => `novaroom.role.${userId}`

export type RoleChange = { from: string; to: string }

type AuthContextValue = {
  configured: boolean
  ready: boolean
  session: Session | null
  profile: Profile | null
  // Set when someone else (an admin) changed this person's role; cleared with dismissRoleChange.
  roleChange: RoleChange | null
  dismissRoleChange: () => void
  requestCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  saveProfile: (profile: Profile) => Promise<void>
  deleteAccount: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

type ProfileRow = {
  display_name: string | null
  role: string | null
  status: string | null
  avatar_url: string | null
  skills: string[] | null
  languages: string[] | null
  domains: string[] | null
}

function readPreviewSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Session
    if (parsed.userId && parsed.email) return parsed
  } catch {
    localStorage.removeItem(SESSION_KEY)
  }
  return null
}

function readPreviewProfiles(): Record<string, Profile> {
  const raw = localStorage.getItem(PROFILES_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Profile>
    // Profiles saved before roles existed have no role field.
    for (const profile of Object.values(parsed)) profile.role ??= ""
    return parsed
  } catch {
    return {}
  }
}

function readKnownRole(userId: string): string | null {
  try {
    return localStorage.getItem(ROLE_KEY(userId))
  } catch {
    return null
  }
}

function writeKnownRole(userId: string, role: string) {
  try {
    localStorage.setItem(ROLE_KEY(userId), role)
  } catch {
    // Not remembered; a change while the app is closed just won't be announced.
  }
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    displayName: row.display_name ?? "",
    role: row.role ?? "",
    status: row.status ?? "",
    avatarUrl: row.avatar_url,
    skills: row.skills ?? [],
    languages: row.languages ?? [],
    domains: row.domains ?? [],
  }
}

async function loadRemoteProfile(userId: string, email: string): Promise<Profile> {
  if (!supabase) return emptyProfile(email)
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, role, status, avatar_url, skills, languages, domains")
    .eq("id", userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return emptyProfile(email)
  return rowToProfile(data as ProfileRow)
}

async function uploadAvatar(userId: string, dataUrl: string): Promise<string> {
  if (!supabase) return dataUrl
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  const path = `${userId}/avatar.jpg`
  const { error } = await supabase.storage.from("avatars").upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  })
  if (error) throw error
  const { data } = supabase.storage.from("avatars").getPublicUrl(path)
  return `${data.publicUrl}?v=${Date.now()}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null)

  // Takes a profile read from the database. Your own role edits are recorded before they are saved,
  // so a role that differs from the last one seen here was changed by someone else.
  const applyLoaded = useCallback((userId: string, loaded: Profile) => {
    const known = readKnownRole(userId)
    writeKnownRole(userId, loaded.role)
    if (known !== null && known !== loaded.role) setRoleChange({ from: known, to: loaded.role })
    setProfile(loaded)
  }, [])

  useEffect(() => {
    if (!supabase) {
      const stored = readPreviewSession()
      setSession(stored)
      if (stored) {
        const profiles = readPreviewProfiles()
        setProfile(profiles[stored.userId] ?? emptyProfile(stored.email))
      }
      setReady(true)
      return
    }

    let active = true
    const client = supabase

    async function apply(next: Session) {
      const loaded = await loadRemoteProfile(next.userId, next.email)
      if (!active) return
      setSession(next)
      applyLoaded(next.userId, loaded)
    }

    client.auth.getSession().then(async ({ data }) => {
      if (!active) return
      const current = data.session
      if (current?.user.email) {
        await apply({ userId: current.user.id, email: current.user.email })
      }
      if (active) setReady(true)
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      if (!next?.user.email) {
        setSession(null)
        setProfile(null)
        return
      }
      void apply({ userId: next.user.id, email: next.user.email })
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [applyLoaded])

  // Keep the profile current while signed in: live updates, plus a reload whenever the window gets
  // focus in case the live connection dropped.
  const userId = session?.userId
  const email = session?.email
  useEffect(() => {
    if (!supabase || !userId || !email) return
    const client = supabase
    let active = true
    const reload = () => {
      void loadRemoteProfile(userId, email)
        .then((loaded) => {
          if (active) applyLoaded(userId, loaded)
        })
        .catch(() => {})
    }
    const channel = client
      .channel(`profile-${userId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
        (payload) => applyLoaded(userId, rowToProfile(payload.new as ProfileRow)),
      )
      .subscribe()
    window.addEventListener("focus", reload)
    return () => {
      active = false
      window.removeEventListener("focus", reload)
      void client.removeChannel(channel)
    }
  }, [userId, email, applyLoaded])

  const value = useMemo<AuthContextValue>(() => {
    return {
      configured: isSupabaseConfigured,
      ready,
      session,
      profile,
      roleChange,
      dismissRoleChange: () => setRoleChange(null),
      async requestCode(email: string) {
        const normalized = email.trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          throw new Error("Enter a valid email address.")
        }
        if (!supabase) return
        const { error } = await supabase.auth.signInWithOtp({
          email: normalized,
          options: { shouldCreateUser: true },
        })
        if (error) throw error
      },
      async verifyCode(email: string, code: string) {
        const normalized = email.trim().toLowerCase()
        const token = code.trim()
        if (!supabase) {
          if (token !== PREVIEW_CODE) {
            throw new Error("That code is not right. In preview, use 000000.")
          }
          const next = { userId: previewUserId(normalized), email: normalized }
          const profiles = readPreviewProfiles()
          const existing = profiles[next.userId] ?? emptyProfile(normalized)
          localStorage.setItem(SESSION_KEY, JSON.stringify(next))
          setSession(next)
          setProfile(existing)
          return
        }
        const { data, error } = await supabase.auth.verifyOtp({
          email: normalized,
          token,
          type: "email",
        })
        if (error) throw error
        const user = data.user ?? data.session?.user
        if (!user?.email) throw new Error("Sign-in did not return an account.")
        const next = { userId: user.id, email: user.email }
        const loaded = await loadRemoteProfile(next.userId, next.email)
        setSession(next)
        applyLoaded(next.userId, loaded)
      },
      async saveProfile(next: Profile) {
        if (!session) throw new Error("Sign in before saving your profile.")
        let avatarUrl = next.avatarUrl
        if (avatarUrl?.startsWith("data:") && supabase) {
          avatarUrl = await uploadAvatar(session.userId, avatarUrl)
        }
        const saved: Profile = { ...next, avatarUrl }
        if (!supabase) {
          const profiles = readPreviewProfiles()
          profiles[session.userId] = saved
          localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
          setProfile(saved)
          return
        }
        // Record the new role first, so its live update isn't announced as someone else's change.
        const knownRole = readKnownRole(session.userId)
        writeKnownRole(session.userId, saved.role)
        const { error } = await supabase.from("profiles").upsert({
          id: session.userId,
          display_name: saved.displayName,
          role: saved.role,
          status: saved.status,
          avatar_url: saved.avatarUrl,
          skills: saved.skills,
          languages: saved.languages,
          domains: saved.domains,
          updated_at: new Date().toISOString(),
        })
        if (error) {
          if (knownRole !== null) writeKnownRole(session.userId, knownRole)
          throw error
        }
        setProfile(saved)
      },
      async deleteAccount() {
        if (!session) throw new Error("Sign in before deleting your account.")
        if (!supabase) {
          deletePreviewAccount(session.userId)
          writeUnread(session.userId, {})
          localStorage.removeItem(SESSION_KEY)
          setSession(null)
          setProfile(null)
          return
        }
        const { error } = await supabase.rpc("delete_own_account")
        if (error) throw safetyError(error)
        writeUnread(session.userId, {})
        await supabase.auth.signOut().catch(() => undefined)
        setSession(null)
        setProfile(null)
      },
      async signOut() {
        if (supabase) {
          const { error } = await supabase.auth.signOut()
          if (error) throw error
        }
        localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setProfile(null)
      },
    }
  }, [applyLoaded, profile, ready, roleChange, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
