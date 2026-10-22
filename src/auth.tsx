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
import { isAuthRetryableFetchError } from "@supabase/supabase-js"
import { isSupabaseConfigured, supabase } from "./lib/supabase"
import { PREVIEW_CODE, PREVIEW_PROFILES_KEY, PREVIEW_SESSION_KEY, previewUserId } from "./lib/preview"
import { deletePreviewAccount, safetyError } from "./lib/safety"
import { writeUnread } from "./lib/unread"

const SESSION_KEY = PREVIEW_SESSION_KEY
const PROFILES_KEY = PREVIEW_PROFILES_KEY
// The last role this computer saw for each account, so a change made while the app was closed is
// still announced on the next start.
const ROLE_KEY = (userId: string) => `novaroom.role.${userId}`
// Who was last signed in on this computer and their profile, so the app can still open (for Local
// chat) when it starts without internet.
const OFFLINE_KEY = "novaroom.offline-identity"
// Every account that has signed in on this computer, newest first. Unlike OFFLINE_KEY this outlasts
// signing out, so the sign-in screen can offer to continue offline as one of them.
const ACCOUNTS_KEY = "novaroom.offline-accounts"
// While offline, how often to try reaching the server again.
const RECONNECT_EVERY_MS = 15 * 1000

export type RoleChange = { from: string; to: string }

type AuthContextValue = {
  configured: boolean
  ready: boolean
  // True when the app opened without reaching the server, from what this computer remembers, or
  // the person chose to continue offline. Only Local chat and Vault work then.
  offline: boolean
  // True when offline was chosen on the sign-in screen. There is no sign-in with the server behind
  // it, so it stays offline until the person signs in; otherwise it ends once the server answers.
  offlineChosen: boolean
  // Accounts that have signed in on this computer and so can continue offline.
  offlineAccounts: OfflineIdentity[]
  signInOffline: (userId: string) => void
  forgetOfflineAccount: (userId: string) => void
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

export type OfflineIdentity = { session: Session; profile: Profile }

function readOfflineIdentity(): OfflineIdentity | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? "null") as OfflineIdentity | null
    return parsed?.session?.userId && parsed.profile ? parsed : null
  } catch {
    return null
  }
}

function writeOfflineIdentity(identity: OfflineIdentity | null) {
  try {
    if (identity) localStorage.setItem(OFFLINE_KEY, JSON.stringify(identity))
    else localStorage.removeItem(OFFLINE_KEY)
  } catch {
    // Not remembered; without internet the app shows the sign-in screen instead.
  }
}

function readOfflineAccounts(): OfflineIdentity[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as OfflineIdentity[]
    return Array.isArray(parsed) ? parsed.filter((item) => item?.session?.userId && item.profile) : []
  } catch {
    return []
  }
}

function writeOfflineAccounts(accounts: OfflineIdentity[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts))
  } catch {
    // Not remembered; the sign-in screen just won't offer this account offline.
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
  const [offline, setOffline] = useState(false)
  const [offlineChosen, setOfflineChosen] = useState(false)
  // Starts with the last account to sign in here, which may predate the list of accounts.
  const [offlineAccounts, setOfflineAccounts] = useState<OfflineIdentity[]>(() => {
    const accounts = readOfflineAccounts()
    const last = readOfflineIdentity()
    if (!last || accounts.some((item) => item.session.userId === last.session.userId)) return accounts
    return [last, ...accounts]
  })

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

    /** Opens with what this computer remembers, when the server cannot be reached. */
    function openOffline(next?: Session) {
      const cached = readOfflineIdentity()
      const session = next ?? cached?.session
      if (!session) return
      setSession(session)
      setProfile(cached?.session.userId === session.userId ? cached.profile : emptyProfile(session.email))
      setOffline(true)
    }

    async function apply(next: Session) {
      let loaded: Profile
      try {
        loaded = await loadRemoteProfile(next.userId, next.email)
      } catch {
        if (active) openOffline(next)
        return
      }
      if (!active) return
      setSession(next)
      applyLoaded(next.userId, loaded)
      setOffline(false)
      setOfflineChosen(false)
    }

    /** Reads the saved sign-in; refreshing an expired one needs the server. */
    async function load() {
      const { data, error } = await client.auth.getSession()
      if (!active) return
      const current = data.session
      if (current?.user.email) await apply({ userId: current.user.id, email: current.user.email })
      else if (error && isAuthRetryableFetchError(error)) openOffline()
      else if (!error) {
        setSession(null)
        setProfile(null)
        setOffline(false)
      }
    }

    void load().finally(() => {
      if (active) setReady(true)
    })

    const { data: subscription } = client.auth.onAuthStateChange((event, next) => {
      if (next?.user.email) {
        void apply({ userId: next.user.id, email: next.user.email })
        return
      }
      // The first event repeats what load() found, which also covers having no connection.
      if (event === "INITIAL_SESSION") return
      setSession(null)
      setProfile(null)
      setOffline(false)
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [applyLoaded])

  // While offline, keep trying the server; the full app opens again once it answers.
  useEffect(() => {
    if (!offline || offlineChosen || !supabase) return
    const client = supabase
    const retry = async () => {
      const { data, error } = await client.auth.getSession()
      const current = data.session
      if (!current?.user.email) {
        // Still no connection, or the sign-in ended for good (handled by onAuthStateChange).
        if (!error || !isAuthRetryableFetchError(error)) setOffline(false)
        if (!error) {
          setSession(null)
          setProfile(null)
        }
        return
      }
      try {
        const next = { userId: current.user.id, email: current.user.email }
        const loaded = await loadRemoteProfile(next.userId, next.email)
        setSession(next)
        applyLoaded(next.userId, loaded)
        setOffline(false)
      } catch {
        // Still offline; try again later.
      }
    }
    const timer = window.setInterval(() => void retry(), RECONNECT_EVERY_MS)
    window.addEventListener("online", retry)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", retry)
    }
  }, [offline, offlineChosen, applyLoaded])

  // Remember who is signed in, for opening without internet next time.
  useEffect(() => {
    if (!supabase || !session || !profile || offline) return
    writeOfflineIdentity({ session, profile })
    setOfflineAccounts((current) => [
      { session, profile },
      ...current.filter((item) => item.session.userId !== session.userId),
    ])
  }, [session, profile, offline])

  useEffect(() => writeOfflineAccounts(offlineAccounts), [offlineAccounts])

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
      offline,
      offlineChosen,
      offlineAccounts,
      signInOffline(userId: string) {
        const account = offlineAccounts.find((item) => item.session.userId === userId)
        if (!account) return
        setSession(account.session)
        setProfile(account.profile)
        setOfflineChosen(true)
        setOffline(true)
      },
      forgetOfflineAccount(userId: string) {
        setOfflineAccounts((current) => current.filter((item) => item.session.userId !== userId))
      },
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
        writeOfflineIdentity(null)
        setOfflineAccounts((current) => current.filter((item) => item.session.userId !== session.userId))
        await supabase.auth.signOut().catch(() => undefined)
        setSession(null)
        setProfile(null)
      },
      async signOut() {
        // Offline by choice has no sign-in with the server to end.
        if (supabase && !offlineChosen) {
          // Without internet, only this computer can forget the sign-in.
          const { error } = await supabase.auth.signOut(offline ? { scope: "local" } : undefined)
          if (error) throw error
        }
        writeOfflineIdentity(null)
        localStorage.removeItem(SESSION_KEY)
        setSession(null)
        setProfile(null)
        setOffline(false)
        setOfflineChosen(false)
      },
    }
  }, [applyLoaded, offline, offlineAccounts, offlineChosen, profile, ready, roleChange, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
