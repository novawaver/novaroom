import type { Profile } from "../types"
import { supabase } from "./supabase"
import { PREVIEW_PROFILES_KEY } from "./preview"

export type RegisteredUser = Profile & { userId: string; isAdmin: boolean }

function readPreviewProfiles(): Record<string, Profile> {
  const raw = localStorage.getItem(PREVIEW_PROFILES_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Profile>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

// Whether the signed-in person is an admin. Offline preview has no admins.
export async function readIsAdmin(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.rpc("is_admin")
  if (error) throw error
  return data === true
}

export async function listUsers(): Promise<RegisteredUser[]> {
  if (!supabase) {
    return Object.entries(readPreviewProfiles())
      .map(([userId, profile]) => ({ ...profile, role: profile.role ?? "", userId, isAdmin: false }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }
  const [{ data, error }, admins] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, status, avatar_url, skills, languages, domains")
      .order("display_name"),
    supabase.rpc("list_admin_ids"),
  ])
  if (error) throw error
  // Admin badges are cosmetic, so a missing list_admin_ids (migration not run yet) just hides them.
  const adminIds = new Set((admins.error ? [] : ((admins.data as string[] | null) ?? [])))
  return (data ?? []).map((row) => ({
    userId: row.id as string,
    isAdmin: adminIds.has(row.id as string),
    displayName: (row.display_name as string | null) ?? "",
    role: (row.role as string | null) ?? "",
    status: (row.status as string | null) ?? "",
    avatarUrl: row.avatar_url as string | null,
    skills: (row.skills as string[] | null) ?? [],
    languages: (row.languages as string[] | null) ?? [],
    domains: (row.domains as string[] | null) ?? [],
  }))
}

export type Person = { name: string; avatarUrl: string | null }

// Looked-up people with when, so a changed picture shows up after a while.
const people = new Map<string, { at: number; person: Promise<Person | null> }>()
const PERSON_FRESH_MS = 10 * 60 * 1000

/** Someone's name and profile picture, for notifications. Null if they can't be found. */
export function personById(id: string | null): Promise<Person | null> {
  if (!id) return Promise.resolve(null)
  const cached = people.get(id)
  if (cached && Date.now() - cached.at < PERSON_FRESH_MS) return cached.person
  const person = (async (): Promise<Person | null> => {
    if (!supabase) {
      const profile = readPreviewProfiles()[id]
      return profile ? { name: profile.displayName, avatarUrl: profile.avatarUrl } : null
    }
    const { data } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", id).maybeSingle()
    const row = data as { display_name: string | null; avatar_url: string | null } | null
    return row ? { name: row.display_name ?? "", avatarUrl: row.avatar_url } : null
  })().catch(() => null)
  people.set(id, { at: Date.now(), person })
  return person
}
