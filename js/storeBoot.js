// Store boot wiring: reconcile real-money entitlements into local skin
// ownership on boot + on sign-in, and handle the return from Stripe hosted
// Checkout (?purchase=success|cancel). Kept separate from entitlements.js so
// that module stays DOM-free and unit-testable; this is the install glue,
// mirroring installCloudSave().

import { reconcile } from "./entitlements.js";
import { isOwned as isSkinOwned } from "./skins.js";
import { isSignedIn, getToken, onAccountChange } from "./accountSession.js";
import { showToast } from "./toast.js";
import { tr } from "./strings.js";

// The webhook (source of truth) may land a beat after Stripe redirects back, so
// reconcile retries a few times with backoff before giving up with a "being
// processed" message.
const RETRY_DELAYS_MS = [0, 2000, 4000];

export function installStore() {
  // Reconcile on every sign-in (a different account may own different skins);
  // sign-out is a no-op here — local ownership is left as-is until the next
  // signed-in reconcile (mirrors how cloudSave leaves local progress on logout).
  onAccountChange((user) => { if (user) reconcile(getToken()).catch(() => {}); });
  if (isSignedIn()) reconcile(getToken()).catch(() => {});
  handlePurchaseReturn();
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function handlePurchaseReturn() {
  let params;
  try { params = new URLSearchParams(location.search || ""); } catch { return; }
  const purchase = params.get("purchase");
  if (!purchase) return;
  const sku = params.get("sku") || "";
  stripPurchaseParams();

  if (purchase === "cancel") return; // user backed out — no error, nothing to do
  if (purchase !== "success") return;

  // refId is the part after "skin." — used to detect when the grant has landed.
  const refId = sku.startsWith("skin.") ? sku.slice("skin.".length) : "";
  for (const wait of RETRY_DELAYS_MS) {
    if (wait) await delay(wait);
    await reconcile(getToken()).catch(() => {});
    if (refId && isSkinOwned(refId)) {
      showToast(tr("store.purchase_success"), "hint");
      return;
    }
  }
  // Grant hasn't shown up yet (webhook still in flight) — reassure the player.
  showToast(tr("store.purchase_processing"), "hint");
}

// Drop ?purchase & ?sku from the URL without a reload, so a refresh doesn't
// re-trigger the toast. Mirrors how the reset deep-link is consumed.
function stripPurchaseParams() {
  try {
    const url = new URL(location.href);
    url.searchParams.delete("purchase");
    url.searchParams.delete("sku");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch { /* ignore */ }
}
