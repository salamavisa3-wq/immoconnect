// paypal.js — Paiement des forfaits propriétaire par PayPal (Orders API v2), en EUR.
// PayPal ne supporte pas le XOF → conversion FCFA→EUR au taux fixe UEMOA 655,957
// (5 000 FCFA ≈ 7,62 € ; 10 000 ≈ 15,24 € ; 15 000 ≈ 22,87 €).
// Clés : PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (developer.paypal.com, app REST).
// PAYPAL_SANDBOX=true (défaut) → api-m.sandbox.paypal.com ; false → api-m.paypal.com.
// Flux : createPayment → redirection vers le lien « approve » ; au retour, la page
// /paiement-paypal.html appelle POST /api/payments/paypal-capture avec l'order_id → capture().

const fetch = require("node-fetch");

const XOF_PER_EUR = 655.957;
const base = () => (process.env.PAYPAL_SANDBOX === "false" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
const clientId = () => process.env.PAYPAL_CLIENT_ID || "";
const clientSecret = () => process.env.PAYPAL_CLIENT_SECRET || "";
const frontendBase = () => process.env.FRONTEND_URL || "https://sakeurimmo.com";

let _token = null, _tokenAt = 0;

/** Token OAuth2 client_credentials (cache ~8 h ; PayPal expire à 9 h). */
async function accessToken() {
  if (_token && Date.now() - _tokenAt < 8 * 3600 * 1000) return _token;
  if (!clientId() || !clientSecret()) throw new Error("PayPal : PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET manquants");
  const resp = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });
  const json = await resp.json().catch(() => ({}));
  if (!json.access_token) throw new Error(`PayPal : token échoué — ${JSON.stringify(json).slice(0, 200)}`);
  _token = json.access_token;
  _tokenAt = Date.now();
  return _token;
}

const eur = (xof) => (Number(xof) / XOF_PER_EUR).toFixed(2);

/** Crée une commande PayPal (intent CAPTURE) et renvoie le lien d'approbation + l'order_id. */
async function createPayment({ reference, montant, description }) {
  const token = await accessToken();
  const resp = await fetch(`${base()}/v2/checkout/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: reference,
        description: String(description || "").slice(0, 127),
        amount: { currency_code: "EUR", value: eur(montant) },
      }],
      application_context: {
        brand_name: "SakeurImmo",
        return_url: `${frontendBase()}/paiement-paypal.html?reference=${encodeURIComponent(reference)}`,
        cancel_url: `${frontendBase()}/inscription.html`,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      },
    }),
  });
  const json = await resp.json().catch(() => ({}));
  const approve = (json.links || []).find((l) => l.rel === "approve");
  if (!approve?.href) throw new Error(`PayPal : création commande échouée — ${JSON.stringify(json).slice(0, 300)}`);
  return { redirect_url: approve.href, order_id: json.id };
}

/**
 * Capture la commande approuvée. Idempotent : si la commande a déjà été capturée
 * (ORDER_ALREADY_CAPTURED, ex. page de retour rechargée ou payée sans jamais revenir),
 * on relit la commande en GET et on considère COMPLETED comme payé.
 */
async function capture({ order_id }) {
  const token = await accessToken();
  const resp = await fetch(`${base()}/v2/checkout/orders/${order_id}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  const json = await resp.json().catch(() => ({}));
  const status = String(json.status || json.name || "").toUpperCase();
  const capture = json.purchase_units?.[0]?.payments?.captures?.[0];

  if (status === "COMPLETED" && capture?.status === "COMPLETED") {
    return {
      paid: true,
      status,
      reference: json.purchase_units?.[0]?.reference_id || "",
      provider_ref: capture?.id || json.id || "",
    };
  }

  // Déjà capturée (422 ORDER_ALREADY_CAPTURED) : relire l'état réel de la commande.
  if (status === "UNPROCESSABLE_ENTITY" && json.details?.some((d) => d.issue === "ORDER_ALREADY_CAPTURED")) {
    const getResp = await fetch(`${base()}/v2/checkout/orders/${order_id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const getJson = await getResp.json().catch(() => ({}));
    if (String(getJson.status || "").toUpperCase() === "COMPLETED") {
      return {
        paid: true,
        status: "COMPLETED",
        reference: getJson.purchase_units?.[0]?.reference_id || "",
        provider_ref: getJson.purchase_units?.[0]?.payments?.captures?.[0]?.id || getJson.id || "",
      };
    }
  }

  return { paid: false, status };
}

module.exports = { createPayment, capture, XOF_PER_EUR };
