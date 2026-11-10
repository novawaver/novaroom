import { useMemo, useState, type FormEvent } from "react"
import {
  isDuplicateSubmission,
  trimAnswers,
  validateAnswers,
  type RoomForm,
  type RoomSubmission,
} from "../lib/rooms"

function formatSubmitted(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

/**
 * A room's form, with the member's own past submissions below it. Plain fields only: it never
 * collects passwords, API keys or other secrets. Shared by the Markdown room page and by custom
 * room pages (src/screens/rooms).
 */
export function RoomFormCard({
  form,
  mySubmissions,
  onSubmit,
  onSubmitted,
}: {
  form: RoomForm
  mySubmissions: RoomSubmission[]
  onSubmit: (answers: Record<string, string>) => Promise<RoomSubmission>
  onSubmitted: (submission: RoomSubmission) => void
}) {
  const empty = useMemo(() => Object.fromEntries(form.fields.map((field) => [field.id, ""])), [form])
  const [answers, setAnswers] = useState<Record<string, string>>(empty)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [justSent, setJustSent] = useState(false)

  function setValue(id: string, value: string) {
    setAnswers((current) => ({ ...current, [id]: value }))
    setJustSent(false)
    setError("")
    // Clear this field's error as soon as it's edited.
    setFieldErrors((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  async function onFormSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validateAnswers(form, answers)
    if (Object.keys(found).length > 0) {
      setFieldErrors(found)
      setError("")
      return
    }
    if (isDuplicateSubmission(form, answers, mySubmissions)) {
      setError("You've already submitted this. Change something before sending it again.")
      return
    }
    setBusy(true)
    setError("")
    setFieldErrors({})
    try {
      const submission = await onSubmit(trimAnswers(form, answers))
      onSubmitted(submission)
      setAnswers(empty)
      setJustSent(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send that in.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="room-form-card" aria-labelledby="room-form-title">
      <h2 id="room-form-title">{form.title?.trim() || "Submit"}</h2>
      {form.intro?.trim() && <p className="room-form-intro">{form.intro}</p>}
      <form className="room-form" onSubmit={onFormSubmit}>
        {form.fields.map((field) => {
          const id = `rf-${field.id}`
          const value = answers[field.id] ?? ""
          const fieldError = fieldErrors[field.id]
          const errorId = fieldError ? `${id}-error` : undefined
          const invalid = fieldError ? true : undefined
          return (
            <label key={field.id} className="room-form-field" htmlFor={id}>
              <span className="room-form-label">
                {field.label}
                {field.required && <span className="room-form-required" aria-hidden="true"> *</span>}
              </span>
              {field.help?.trim() && <span className="room-form-help">{field.help}</span>}
              {field.type === "textarea" ? (
                <textarea
                  id={id}
                  rows={3}
                  value={value}
                  maxLength={field.maxLength}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              ) : field.type === "select" ? (
                <select
                  id={id}
                  value={value}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  onChange={(event) => setValue(field.id, event.target.value)}
                >
                  <option value="">Choose…</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  type={field.type === "number" ? "number" : "text"}
                  value={value}
                  maxLength={field.type === "number" ? undefined : field.maxLength}
                  min={field.type === "number" ? field.min : undefined}
                  max={field.type === "number" ? field.max : undefined}
                  inputMode={field.format === "url" ? "url" : undefined}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              )}
              {fieldError && (
                <span id={errorId} className="room-form-field-error" role="alert">
                  {fieldError}
                </span>
              )}
            </label>
          )
        })}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {justSent && (
          <p className="room-form-sent" role="status">
            Sent. Thank you.
          </p>
        )}
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Sending…" : form.submitLabel?.trim() || "Submit"}
        </button>
      </form>
      {mySubmissions.length > 0 && (
        <div className="room-form-mine">
          <h3>Your submissions</h3>
          <ul>
            {mySubmissions.map((submission) => (
              <li key={submission.id}>
                <time dateTime={submission.createdAt}>{formatSubmitted(submission.createdAt)}</time>
                <dl>
                  {form.fields
                    .filter((field) => String(submission.answers[field.id] ?? "").trim())
                    .map((field) => (
                      <div key={field.id}>
                        <dt>{field.label}</dt>
                        <dd>{submission.answers[field.id]}</dd>
                      </div>
                    ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
