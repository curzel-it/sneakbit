// Build-target gating. The web build (sneakbit.curzel.it) is the only channel
// for real-money purchases for now — native iOS/Android/Steam builds each
// mandate their own store IAP and come much later down the line. Until then the
// real-money store UI is hidden in those builds.
//
// Default true (web). A native packaging step flips this to false (e.g. by
// stamping window.__SNEAKBIT_NATIVE__ before the modules load), without any
// other code change.

export function isWebStoreEnabled() {
  if (typeof window !== "undefined" && window.__SNEAKBIT_NATIVE__ === true) return false;
  return true;
}
