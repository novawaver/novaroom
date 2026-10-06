export type Profile = {
  displayName: string
  status: string
  avatarUrl: string | null
  skills: string[]
  languages: string[]
  domains: string[]
}

export type Session = {
  userId: string
  email: string
}

export function emptyProfile(email: string): Profile {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim() ?? ""
  const displayName = local
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
  return {
    displayName,
    status: "",
    avatarUrl: null,
    skills: [],
    languages: [],
    domains: [],
  }
}
