import * as React from "react"
import { PHONE_MAX, PHONE_MEDIA_QUERY } from "@/lib/breakpoints"

/** True on a phone-width viewport (D68: max-width 859px; iPad portrait included). */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(PHONE_MEDIA_QUERY)
    const onChange = () => {
      setIsMobile(window.innerWidth <= PHONE_MAX)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth <= PHONE_MAX)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
