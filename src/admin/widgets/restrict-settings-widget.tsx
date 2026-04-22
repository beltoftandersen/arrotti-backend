import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect } from "react"

/**
 * UI-only hide of specified sidebar sections for restricted admin users.
 * Not a security boundary — /admin/* APIs remain reachable.
 *
 * Hides by:
 *  1. CSS for Settings link (hrefs are stable).
 *  2. A MutationObserver-driven JS pass for label-based matches
 *     ("Extensions" is a section header, not an anchor with a stable href).
 */

const RESTRICTED_EMAILS = ["orders@arrottigroup.com"]
const STYLE_ID = "arrotti-restrict-sidebar-style"
const HIDE_LABELS: string[] = []
const CACHE_KEY = "arrotti_admin_email"

const STATIC_CSS = `
  a[href="/app/settings"],
  a[href^="/app/settings/"],
  [data-sidebar-link="settings"] {
    display: none !important;
  }
`

const isRestricted = (email: string | null | undefined): boolean =>
  !!email && RESTRICTED_EMAILS.includes(email.toLowerCase())

const injectStyle = () => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = STATIC_CSS
  document.head.appendChild(style)
}

const findSidebarItemByText = (text: string): HTMLElement | null => {
  const candidates = document.querySelectorAll<HTMLElement>(
    "nav a, nav [role='menuitem'], nav button, aside a, aside button"
  )
  for (const el of Array.from(candidates)) {
    const label = el.textContent?.trim()
    if (label === text) {
      let target: HTMLElement = el
      let p: HTMLElement | null = el.parentElement
      while (p && p.tagName !== "NAV" && p.tagName !== "ASIDE") {
        if (
          p.tagName === "LI" ||
          p.getAttribute("role") === "menuitem" ||
          p.getAttribute("role") === "group"
        ) {
          target = p
          break
        }
        p = p.parentElement
      }
      return target
    }
  }
  return null
}

const hideLabels = () => {
  for (const label of HIDE_LABELS) {
    const el = findSidebarItemByText(label)
    if (el && el.style.display !== "none") {
      el.style.display = "none"
    }
  }
}

// Synchronous read of cached email so restricted users get no flicker on
// sessions after the first login.
let cachedEmail: string | null = null
try {
  cachedEmail = typeof window !== "undefined"
    ? window.localStorage.getItem(CACHE_KEY)
    : null
} catch {
  cachedEmail = null
}
if (isRestricted(cachedEmail)) {
  // Fires at module-eval time — before the widget component renders.
  if (typeof document !== "undefined") {
    injectStyle()
  }
}

const RestrictSettingsWidget = () => {
  useEffect(() => {
    let cancelled = false
    let observer: MutationObserver | null = null

    const apply = () => {
      injectStyle()
      hideLabels()
      if (!observer) {
        observer = new MutationObserver(() => hideLabels())
        observer.observe(document.body, { childList: true, subtree: true })
      }
    }

    // Apply immediately from cache to beat the sidebar paint
    if (isRestricted(cachedEmail)) {
      apply()
    }

    ;(async () => {
      try {
        const res = await fetch("/admin/users/me", { credentials: "include" })
        if (!res.ok) return
        const data = await res.json()
        const email: string | undefined = data?.user?.email
        if (cancelled || !email) return

        try { window.localStorage.setItem(CACHE_KEY, email) } catch {}
        cachedEmail = email

        if (isRestricted(email)) apply()
      } catch {
        // silent — UI hint only
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
    }
  }, [])

  return null
}

export const config = defineWidgetConfig({
  zone: "order.list.before",
})

export default RestrictSettingsWidget
