// The buy action for a real-money store SKU. Hosted Checkout is just a
// top-level redirect — the browser never loads Stripe.js. Signed-out users are
// sent to the account panel first (entitlements are account-bound).
//
// One feature one file: shop.js handles presentation; this owns the click →
// checkout → redirect flow.

import { isSignedIn, getToken } from "./accountSession.js";
import { openAccountPanel } from "./accountPanel.js";
import { createCheckout } from "./storeApi.js";
import { getCurrency } from "./storeCurrency.js";
import { showToast } from "./toast.js";
import { tr } from "./strings.js";

// Begin checkout for a SKU. Returns true if a redirect was initiated. On any
// error the user stays put with a friendly toast (the shop stays open).
export async function startCheckout(sku) {
  if (!isSignedIn()) {
    openAccountPanel("signin");
    return false;
  }
  const r = await createCheckout(getToken(), { sku, currency: getCurrency() });
  if (r.ok && r.data?.url) {
    location.assign(r.data.url);   // top-level redirect to Stripe hosted Checkout
    return true;
  }
  if (r.offline) showToast(tr("store.offline"), "hint");
  else if (r.error === "already_owned") showToast(tr("store.already_owned"), "hint");
  else showToast(tr("store.checkout_failed"), "hint");
  return false;
}
