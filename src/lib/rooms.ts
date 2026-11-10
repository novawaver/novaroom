import type { Session } from "../types"
import { PREVIEW_CHATS_KEY, PREVIEW_PROFILES_KEY } from "./preview"
import { supabase } from "./supabase"

export type RoomInfo = {
  id: string
  title: string
  description: string
  /** The room's web-address slug, which also selects its custom page (src/screens/rooms). */
  slug: string | null
  joined: boolean
}

export type RoomLink = { id: string; title: string; url: string }
export type RoomMember = { id: string; name: string; avatarUrl: string | null }

// A room's form. Admins build it on the admin site; members fill it in on the room's page.
// Plain fields only — never use this to collect passwords, API keys or other secrets.
export type RoomFieldType = "text" | "textarea" | "select" | "number"
// An optional shape check for a text field. Never a secret — these only recognise public values.
export type RoomFieldFormat = "url" | "evm-address"
export type RoomField = {
  id: string
  label: string
  type: RoomFieldType
  options?: string[] // for "select"
  required?: boolean
  help?: string
  format?: RoomFieldFormat // for "text": validate the shape on submit
  min?: number // for "number": smallest allowed value
  max?: number // for "number": largest allowed value
  maxLength?: number // for "text"/"textarea": character limit
}
export type RoomForm = {
  title?: string
  intro?: string
  submitLabel?: string
  fields: RoomField[]
}
export type RoomSubmission = {
  id: string
  userId: string | null
  userName?: string
  answers: Record<string, string>
  createdAt: string
}

/** A room's public detail, for the /room/<slug> page. memberCount is null unless the viewer is a member. */
export type RoomDetail = {
  id: string
  title: string
  description: string
  page: string
  memberCount: number | null
  joined: boolean
}

/** Turns a title into a web-address slug: lowercase letters, numbers and single hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** What a room's page shows. The form, links and members are only for members, so they are empty before joining. */
export type RoomPageData = {
  page: string
  updatedAt: string | null
  form: RoomForm | null
  mySubmissions: RoomSubmission[]
  links: RoomLink[]
  members: RoomMember[]
}

/** Keeps only the fields a form still has, in case the form changed after someone filled it in. */
export function trimAnswers(form: RoomForm | null, answers: Record<string, string>): Record<string, string> {
  if (!form) return {}
  const out: Record<string, string> = {}
  for (const field of form.fields) {
    const value = answers[field.id]
    if (value != null && String(value).trim() !== "") out[field.id] = String(value)
  }
  return out
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/**
 * Checks a filled-in form against its fields and returns a map of field id → error message for the
 * fields that fail (empty map means it's valid). Data-quality checks only: required fields, number
 * ranges, text length, and the shape of a link or a wallet address. It never inspects secrets,
 * because the form never collects any.
 */
export function validateAnswers(form: RoomForm, answers: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of form.fields) {
    const value = String(answers[field.id] ?? "").trim()
    if (!value) {
      if (field.required) errors[field.id] = `${field.label} is required.`
      continue
    }
    if (field.maxLength != null && value.length > field.maxLength) {
      errors[field.id] = `${field.label} must be ${field.maxLength} characters or fewer.`
      continue
    }
    if (field.type === "number") {
      const n = Number(value)
      if (!Number.isFinite(n)) {
        errors[field.id] = `${field.label} must be a number.`
        continue
      }
      if (field.min != null && n < field.min) {
        errors[field.id] = `${field.label} must be ${field.min} or more.`
        continue
      }
      if (field.max != null && n > field.max) {
        errors[field.id] = `${field.label} must be ${field.max} or less.`
        continue
      }
    }
    if (field.format === "url" && !isHttpUrl(value)) {
      errors[field.id] = `${field.label} must be a link starting with http:// or https://.`
      continue
    }
    if (field.format === "evm-address" && !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      errors[field.id] = `${field.label} must be a wallet address: 0x followed by 40 hex characters.`
      continue
    }
  }
  return errors
}

/** True if this filled-in form exactly matches one the member already sent, to stop double submits. */
export function isDuplicateSubmission(
  form: RoomForm,
  answers: Record<string, string>,
  mySubmissions: RoomSubmission[],
): boolean {
  const current = trimAnswers(form, answers)
  const keys = Object.keys(current)
  return mySubmissions.some((submission) => {
    const prev = trimAnswers(form, submission.answers)
    const prevKeys = Object.keys(prev)
    return prevKeys.length === keys.length && keys.every((key) => prev[key] === current[key])
  })
}

type StoredConversation = {
  id: string
  memberIds: string[]
  createdAt: string
  kind?: string
  title?: string | null
  description?: string | null
  slug?: string | null
}

// Local preview has no admin site, so its rooms come with sample pages and the links the rooms SQL adds.
const PREVIEW_PAGES: Record<string, { page: string; links: RoomLink[] }> = {
  "preview-room-coding": {
    page: "# Welcome to Coding\n\nTalk through coding tasks, tools and prompts with the rest of the team.\n\n## Before you ask\n\n- Say which **language** and **task type** you're on\n- Paste the smallest piece of code that shows the problem\n- Never paste client data or credentials\n\n## Useful habits\n\n1. Run the code before you rate it\n2. Check edge cases: empty input, very large input, bad types\n3. Explain *why* a response is wrong, not just that it is\n\n> Questions are welcome. Nobody knows everything.",
    links: [{ id: "preview-link-coding", title: "Python docs", url: "https://docs.python.org/3/" }],
  },
  "preview-room-writing": {
    page: "# Welcome to Writing\n\nStyle, tone and prompt-writing questions go here.\n\n- Share the prompt and what you expected\n- Quote the sentence you're unsure about",
    links: [{ id: "preview-link-writing", title: "Purdue OWL", url: "https://owl.purdue.edu/owl/general_writing/index.html" }],
  },
  "preview-room-math": {
    page: "# Welcome to Math\n\nChecks, explanations and tricky problems.\n\nWrite expressions as plain text, for example `x^2 + 3x - 4`.",
    links: [{ id: "preview-link-math", title: "Khan Academy", url: "https://www.khanacademy.org/" }],
  },
  "preview-room-rating": {
    page: "# Welcome to Rating\n\nComparisons, rubrics and review habits.",
    links: [
      {
        id: "preview-link-rating",
        title: "What is RLHF",
        url: "https://en.wikipedia.org/wiki/Reinforcement_learning_from_human_feedback",
      },
    ],
  },
  "preview-room-earn": {
    page: "# Earn\n\nPick up a task, finish it, and submit it here for review. Approved tasks are paid to the wallet you give below.\n\n## How it works\n\n1. Choose a task type\n2. Share a link to your finished work\n3. Add the wallet address you want to be paid at\n\n> Only submit work that's yours. Never share passwords or API keys — this form never asks for them.",
    links: [],
  },
}

// A sample form so preview mode shows the capability. In the real app each form is built per room
// on the admin site. This one is a task submission with a payout address — and no secrets.
const PREVIEW_FORMS: Record<string, RoomForm> = {
  "preview-room-rating": {
    title: "Submit a completed task",
    intro: "Done a rating task? Send it here and we'll review it for payout.",
    submitLabel: "Submit task",
    fields: [
      { id: "task", label: "Task type", type: "select", options: ["Pairwise comparison", "Rubric scoring", "Red-teaming"], required: true },
      { id: "link", label: "Link to your work", type: "text", required: true, help: "A shared document or export of the finished task." },
      { id: "notes", label: "Notes", type: "textarea", help: "Anything the reviewer should know." },
      { id: "wallet", label: "Payout wallet address", type: "text", required: true },
    ],
  },
  "preview-room-earn": {
    title: "Submit a completed task",
    intro: "Done a task? Send it here and we'll review it for payout.",
    submitLabel: "Submit task",
    fields: [
      { id: "task", label: "Task type", type: "select", options: ["Data labeling", "Review", "Research"], required: true },
      { id: "link", label: "Link to your work", type: "text", required: true, format: "url", help: "A shared document or export of the finished task." },
      { id: "notes", label: "Notes", type: "textarea", maxLength: 500, help: "Anything the reviewer should know." },
      { id: "wallet", label: "Payout wallet address", type: "text", required: true, format: "evm-address" },
    ],
  },
}

const PREVIEW_SUBMISSIONS_KEY = "novaroom.preview.room-submissions"

type StoredSubmission = RoomSubmission & { conversationId: string }

function readPreviewSubmissions(): StoredSubmission[] {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_SUBMISSIONS_KEY) ?? "[]")
  } catch {
    return []
  }
}

function writePreviewSubmissions(rows: StoredSubmission[]) {
  localStorage.setItem(PREVIEW_SUBMISSIONS_KEY, JSON.stringify(rows))
}

type StoredDb = {
  conversations: StoredConversation[]
  messages: unknown[]
}

const SEED: StoredConversation[] = [
  {
    id: "preview-room-coding",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Coding",
    description: "Coding tasks, tools, and prompts.",
  },
  {
    id: "preview-room-writing",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Writing",
    description: "Writing tasks, style, and prompts.",
  },
  {
    id: "preview-room-math",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Math",
    description: "Math tasks, checks, and explanations.",
  },
  {
    id: "preview-room-rating",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Rating",
    description: "Rating, comparisons, and review habits.",
  },
  {
    id: "preview-room-earn",
    memberIds: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    kind: "room",
    title: "Earn",
    description: "Submit completed tasks and track payouts.",
    slug: "earn-reward-aicredits",
  },
]

function roomsError(error: { message: string }) {
  if (/does not exist|schema cache|Could not find the function|404/i.test(error.message)) {
    return new Error("Run the rooms SQL script in the README, then try again.")
  }
  return new Error(error.message)
}

function readDb(): StoredDb {
  const raw = localStorage.getItem(PREVIEW_CHATS_KEY)
  if (!raw) return { conversations: [], messages: [] }
  try {
    const parsed = JSON.parse(raw) as StoredDb
    return {
      conversations: parsed.conversations ?? [],
      messages: parsed.messages ?? [],
    }
  } catch {
    return { conversations: [], messages: [] }
  }
}

function writeDb(db: StoredDb) {
  localStorage.setItem(PREVIEW_CHATS_KEY, JSON.stringify(db))
}

export function ensurePreviewRooms() {
  if (supabase) return
  const db = readDb()
  let changed = false
  for (const room of SEED) {
    if (db.conversations.some((item) => item.id === room.id)) continue
    db.conversations.push({
      id: room.id,
      memberIds: [],
      createdAt: room.createdAt,
      kind: "room",
      title: room.title,
      description: room.description,
      slug: room.slug ?? null,
    })
    changed = true
  }
  if (changed) writeDb(db)
}

export async function listRooms(session: Session): Promise<RoomInfo[]> {
  if (!supabase) {
    ensurePreviewRooms()
    return readDb()
      .conversations.filter((conversation) => conversation.kind === "room")
      .map((conversation) => ({
        id: conversation.id,
        title: conversation.title?.trim() || "Room",
        description: conversation.description?.trim() || "Topic room",
        slug: conversation.slug ?? (slugify(conversation.title ?? "") || null),
        joined: conversation.memberIds.includes(session.userId),
      }))
  }

  // Try with the slug column; fall back without it if the room slugs SQL hasn't been run yet.
  let rows: { id: string; title: string | null; description: string | null; slug?: string | null }[]
  const withSlug = await supabase
    .from("conversations")
    .select("id, title, description, slug")
    .eq("kind", "room")
    .order("title")
  if (withSlug.error) {
    if (/slug/i.test(withSlug.error.message)) {
      const noSlug = await supabase
        .from("conversations")
        .select("id, title, description")
        .eq("kind", "room")
        .order("title")
      if (noSlug.error) {
        if (/description|does not exist|schema cache/i.test(noSlug.error.message)) return []
        throw roomsError(noSlug.error)
      }
      rows = (noSlug.data ?? []) as typeof rows
    } else if (/description|does not exist|schema cache/i.test(withSlug.error.message)) {
      return []
    } else {
      throw roomsError(withSlug.error)
    }
  } else {
    rows = (withSlug.data ?? []) as typeof rows
  }

  const { data: memberships, error: memberError } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", session.userId)
  if (memberError) throw roomsError(memberError)
  const joined = new Set((memberships ?? []).map((row) => row.conversation_id as string))

  return rows.map((room) => ({
    id: room.id as string,
    title: (room.title ?? "").trim() || "Room",
    description: (room.description ?? "").trim() || "Topic room",
    slug: (room.slug ?? null) || null,
    joined: joined.has(room.id as string),
  }))
}

function readPreviewNames(): Record<string, { displayName?: string; avatarUrl?: string | null }> {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_PROFILES_KEY) ?? "{}")
  } catch {
    return {}
  }
}

function byName(a: RoomMember, b: RoomMember) {
  return a.name.localeCompare(b.name)
}

export async function loadRoomPage(session: Session, roomId: string): Promise<RoomPageData> {
  if (!supabase) {
    ensurePreviewRooms()
    const room = readDb().conversations.find((item) => item.id === roomId)
    const sample = PREVIEW_PAGES[roomId]
    const joined = Boolean(room?.memberIds.includes(session.userId))
    const names = readPreviewNames()
    return {
      page: sample?.page ?? "",
      updatedAt: null,
      form: PREVIEW_FORMS[roomId] ?? null,
      mySubmissions: joined
        ? readPreviewSubmissions()
            .filter((row) => row.conversationId === roomId && row.userId === session.userId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [],
      links: joined ? (sample?.links ?? []) : [],
      members: joined
        ? (room?.memberIds ?? [])
            .map((id) => ({ id, name: names[id]?.displayName || "Trainer", avatarUrl: names[id]?.avatarUrl ?? null }))
            .sort(byName)
        : [],
    }
  }

  // Without the room pages SQL the page/form columns don't exist yet; the page is then just empty.
  const pageQuery = await supabase
    .from("conversations")
    .select("page, page_updated_at, form")
    .eq("id", roomId)
    .maybeSingle()
  if (pageQuery.error && !/page|form|does not exist|schema cache/i.test(pageQuery.error.message)) {
    throw roomsError(pageQuery.error)
  }
  const pageRow = pageQuery.error
    ? null
    : (pageQuery.data as { page: string | null; page_updated_at: string | null; form: RoomForm | null } | null)

  const form = (pageRow?.form as RoomForm | null) ?? null

  const [linkQuery, memberQuery, submissionQuery] = await Promise.all([
    supabase.from("room_resources").select("id, title, url").eq("conversation_id", roomId).order("created_at"),
    supabase.from("conversation_members").select("user_id").eq("conversation_id", roomId),
    // Row-level security returns only this person's own submissions. Missing before the SQL is run.
    form
      ? supabase
          .from("room_submissions")
          .select("id, answers, created_at")
          .eq("conversation_id", roomId)
          .eq("user_id", session.userId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (linkQuery.error) throw roomsError(linkQuery.error)
  if (memberQuery.error) throw roomsError(memberQuery.error)
  const mySubmissions: RoomSubmission[] =
    submissionQuery.error || !submissionQuery.data
      ? []
      : submissionQuery.data.map((row) => ({
          id: row.id as string,
          userId: session.userId,
          answers: (row.answers as Record<string, string>) ?? {},
          createdAt: row.created_at as string,
        }))

  const memberIds = (memberQuery.data ?? []).map((row) => row.user_id as string)
  let members: RoomMember[] = []
  if (memberIds.length) {
    const { data, error } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", memberIds)
    if (error) throw roomsError(error)
    members = (data ?? [])
      .map((row) => ({
        id: row.id as string,
        name: ((row.display_name as string | null) ?? "").trim() || "Trainer",
        avatarUrl: (row.avatar_url as string | null) ?? null,
      }))
      .sort(byName)
  }

  return {
    page: pageRow?.page ?? "",
    updatedAt: pageRow?.page_updated_at ?? null,
    form,
    mySubmissions,
    links: (linkQuery.data ?? []).map((row) => ({
      id: row.id as string,
      title: row.title as string,
      url: row.url as string,
    })),
    members,
  }
}

/** A member sends in one filled-in room form. The answers map is keyed by field id. */
export async function submitRoomForm(
  session: Session,
  roomId: string,
  answers: Record<string, string>,
): Promise<RoomSubmission> {
  if (!supabase) {
    const row: StoredSubmission = {
      id: crypto.randomUUID(),
      conversationId: roomId,
      userId: session.userId,
      answers,
      createdAt: new Date().toISOString(),
    }
    writePreviewSubmissions([row, ...readPreviewSubmissions()])
    return row
  }
  const { data, error } = await supabase
    .from("room_submissions")
    .insert({ conversation_id: roomId, user_id: session.userId, answers })
    .select("id, answers, created_at")
    .single()
  if (error) throw roomsError(error)
  return {
    id: data.id as string,
    userId: session.userId,
    answers: (data.answers as Record<string, string>) ?? {},
    createdAt: data.created_at as string,
  }
}

/** Finds a room by its slug, for the /room/<slug> detail page. Signed-in only. Null if there is none. */
export async function loadRoomBySlug(session: Session, slug: string): Promise<RoomDetail | null> {
  const wanted = slugify(slug)
  if (!wanted) return null
  if (!supabase) {
    ensurePreviewRooms()
    const room = readDb().conversations.find(
      (item) => item.kind === "room" && (item.slug ?? slugify(item.title ?? "")) === wanted,
    )
    if (!room) return null
    const joined = room.memberIds.includes(session.userId)
    return {
      id: room.id,
      title: room.title?.trim() || "Room",
      description: room.description?.trim() || "Topic room",
      page: PREVIEW_PAGES[room.id]?.page ?? "",
      memberCount: joined ? room.memberIds.length : null,
      joined,
    }
  }

  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, description, page")
    .eq("kind", "room")
    .eq("slug", wanted)
    .maybeSingle()
  if (error) {
    if (/slug|page|column|does not exist|schema cache/i.test(error.message)) {
      throw new Error("Run the room slugs SQL script in the README, then try again.")
    }
    throw roomsError(error)
  }
  if (!data) return null

  const roomId = data.id as string
  // Membership and the count are visible to members only ("Members can see participants").
  const { data: members } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", roomId)
  const memberIds = (members ?? []).map((row) => row.user_id as string)
  const joined = memberIds.includes(session.userId)
  return {
    id: roomId,
    title: ((data.title as string | null) ?? "").trim() || "Room",
    description: ((data.description as string | null) ?? "").trim() || "Topic room",
    page: (data.page as string | null) ?? "",
    memberCount: joined ? memberIds.length : null,
    joined,
  }
}

export async function joinRoom(session: Session, roomId: string) {
  if (!supabase) {
    ensurePreviewRooms()
    const db = readDb()
    const room = db.conversations.find((item) => item.id === roomId && item.kind === "room")
    if (!room) throw new Error("That room is not available.")
    if (!room.memberIds.includes(session.userId)) room.memberIds.push(session.userId)
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("join_room", { room_id: roomId })
  if (error) throw roomsError(error)
}

export async function leaveRoom(session: Session, roomId: string) {
  if (!supabase) {
    const db = readDb()
    const room = db.conversations.find((item) => item.id === roomId && item.kind === "room")
    if (!room) return
    room.memberIds = room.memberIds.filter((id) => id !== session.userId)
    writeDb(db)
    return
  }
  const { error } = await supabase.rpc("leave_room", { room_id: roomId })
  if (error) throw roomsError(error)
}
