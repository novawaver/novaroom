import type { Profile } from "../types"
import { supabase } from "./supabase"
import { PREVIEW_PROFILES_KEY } from "./preview"

export type RegisteredUser = Profile & { userId: string }

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

export async function listUsers(): Promise<RegisteredUser[]> {
  if (!supabase) {
    return Object.entries(readPreviewProfiles())
      .map(([userId, profile]) => ({ ...profile, role: profile.role ?? "", userId }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, status, avatar_url, skills, languages, domains")
    .order("display_name")
  if (error) throw error
  return (data ?? []).map((row) => ({
    userId: row.id as string,
    displayName: (row.display_name as string | null) ?? "",
    role: (row.role as string | null) ?? "",
    status: (row.status as string | null) ?? "",
    avatarUrl: row.avatar_url as string | null,
    skills: (row.skills as string[] | null) ?? [],
    languages: (row.languages as string[] | null) ?? [],
    domains: (row.domains as string[] | null) ?? [],
  }))
}
