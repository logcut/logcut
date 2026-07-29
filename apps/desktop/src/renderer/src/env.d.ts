// Ambient declarations for the renderer. This file must stay a script: with a
// top-level import or export, `declare module` below would be read as an
// augmentation of an existing module instead of an ambient declaration, and the
// asset import would not resolve. Hence the inline `import(...)` type.
interface Window {
  logcut: import('../../shared/ipc').LogcutApi
}

// Vite resolves an asset import to its URL. Declared here rather than by
// pulling in vite/client, which would widen the renderer's ambient types.
declare module '*.svg' {
  const src: string
  export default src
}

// A stylesheet is imported for its side effect and has nothing to export — the
// module only has to be known to exist. TypeScript 6 checks side-effect imports
// where 5 did not, so without this `import './styles.css'` fails to resolve.
declare module '*.css' {}
