/* ============================================================
   payments.js
   ------------------------------------------------------------
   One shared module for starting a Razorpay purchase — used by
   every "Buy" button on the site, so there's exactly one
   implementation, not one per page.

   The frontend sends ONLY product_id. Price/credits/validity/
   pass_type are never read from the DOM or trusted from here —
   they're looked up server-side by create-razorpay-order.
   ============================================================ */

const RAZORPAY_CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayScriptLoaded = false;

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (razorpayScriptLoaded || window.Razorpay) {
      razorpayScriptLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_SRC;
    script.onload = () => { razorpayScriptLoaded = true; resolve(); };
    script.onerror = () => reject(new Error("Could not load Razorpay checkout."));
    document.head.appendChild(script);
  });
}

async function callEdgeFunction(name, body) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) throw new Error("You must be logged in to make a purchase.");

  const res = await fetch(SUPABASE_URL + "/functions/v1/" + name, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

// Call this from a Buy button's click handler:
//   startPurchase(productId, { onSuccess, onFailure, buttonEl })
async function startPurchase(productId, options) {
  options = options || {};
  const btn = options.buttonEl;
  const originalText = btn ? btn.textContent : null;

  try {
    if (btn) { btn.disabled = true; btn.textContent = "Starting payment..."; }

    const order = await callEdgeFunction("create-razorpay-order", { product_id: productId });
    await loadRazorpayScript();

    const rzp = new Razorpay({
      key: order.key_id, // public key only
      amount: order.amount,
      currency: order.currency,
      name: "TypeShala",
      description: order.product_name,
      order_id: order.order_id,
      handler: async function (response) {
        try {
          const result = await callEdgeFunction("verify-razorpay-payment", {
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
          });
          if (options.onSuccess) options.onSuccess(result);
        } catch (err) {
          if (options.onFailure) options.onFailure(err.message || "Payment could not be verified. Please contact support if you were charged.");
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
      },
      modal: {
        ondismiss: function () {
          if (btn) { btn.disabled = false; btn.textContent = originalText; }
          if (options.onFailure) options.onFailure("Payment was cancelled.");
        },
      },
      theme: { color: "#B23A2E" },
    });

    rzp.on("payment.failed", function () {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      if (options.onFailure) options.onFailure("Payment could not be completed. Please try again.");
    });

    rzp.open();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = originalText; }
    if (options.onFailure) options.onFailure(err.message || "Could not start payment. Please try again.");
  }
}
