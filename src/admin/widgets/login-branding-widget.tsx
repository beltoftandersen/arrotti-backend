import { defineWidgetConfig } from "@medusajs/admin-sdk"

const LOGO_URL = "https://carparts.chimkins.com/logo.png"

const LoginBrandingWidget = () => {
  return (
    <style>{`
      /* Hide the Medusa icon avatar on the login page */
      .min-h-dvh .max-w-\\[280px\\] .h-\\[50px\\].w-\\[50px\\] {
        width: 180px !important;
        height: 85px !important;
        background: url("${LOGO_URL}") center / contain no-repeat !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
      .min-h-dvh .max-w-\\[280px\\] .h-\\[50px\\].w-\\[50px\\]::after {
        display: none !important;
      }
      .min-h-dvh .max-w-\\[280px\\] .h-\\[50px\\].w-\\[50px\\] > * {
        display: none !important;
      }
    `}</style>
  )
}

export const config = defineWidgetConfig({
  zone: "login.before",
})

export default LoginBrandingWidget
