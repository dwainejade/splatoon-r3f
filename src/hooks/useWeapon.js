import { useEffect, useState } from 'react'
import { WEAPON_ORDER, WEAPONS } from '../settings.js'

// Weapon slots on the number keys. Listens on window rather than the canvas
// because the pointer is locked during a run, so the canvas never has focus.
export default function useWeapon() {
  const [slot, setSlot] = useState(0)

  useEffect(() => {
    const onKey = (event) => {
      const pressed = Number(event.key)
      if (!Number.isInteger(pressed)) return
      if (pressed < 1 || pressed > WEAPON_ORDER.length) return
      setSlot(pressed - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { weapon: WEAPONS[WEAPON_ORDER[slot]], slot }
}
