import { createContext, useContext, useMemo, useState } from "react";

// The blurred sky the ink mirrors back.
//
// Explicit context rather than three's scene.environment slot: that slot
// expects a PMREM-processed cubemap and is consumed automatically by standard
// materials, whereas this is a plain equirect map read by one hand-written
// shader. Passing it deliberately keeps the dependency visible and stops it
// silently changing how anything else in the scene is lit.
const SkyReflectionContext = createContext({ texture: null, publish: () => {} });

export function useSkyReflection() {
  return useContext(SkyReflectionContext);
}

export function SkyReflectionProvider({ children }) {
  const [texture, setTexture] = useState(null);
  const value = useMemo(() => ({ texture, publish: setTexture }), [texture]);
  return (
    <SkyReflectionContext.Provider value={value}>
      {children}
    </SkyReflectionContext.Provider>
  );
}
