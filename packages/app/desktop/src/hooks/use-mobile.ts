import * as React from "react"

export function useIsMobile(breakpoint: number = 768) {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const m = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    if (m.matches !== isMobile) {
      setIsMobile(m.matches)
    }
    const listener = () => setIsMobile(m.matches)
    m.addEventListener("change", listener)
    return () => m.removeEventListener("change", listener)
  }, [isMobile, breakpoint])

  return isMobile ?? false
}
