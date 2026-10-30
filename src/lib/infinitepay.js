// ============================================================
// IANF - Cliente da API Checkout da InfinitePay (Cloudwalk)
// Link de pagamento: POST /links | Consulta: POST /payment_check
// ============================================================

const BASE = 'https://api.checkout.infinitepay.io';

export const VALOR_ASSINATURA_CENTS = 28980; // R$ 289,80
export const DIAS_PERIODO = 30;

export function infinitepayEnabled(env) {
  return Boolean(env.INFINITEPAY_API_KEY);
}

function headers(env) {
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': env.INFINITEPAY_API_KEY || '',
  };
}

// Cria um link de checkout (PIX + cartão de crédito, pagamento único)
export async function criarLinkCheckout(env, { valorCents, descricao, orderNsu, cliente, webhookUrl, validUntil, metodos = ['credit_card', 'pix'] }) {
  const payload = {
    handle: env.PAYMENT_HANDLE || 'droppfy',
    items: [{ quantity: 1, price: valorCents, description: descricao }],
    options: {
      payment_methods_enabled: metodos,
      single_payment: true,
      assured_installments: 3,
      require_delivery_address: false,
    },
  };
  if (orderNsu) payload.order_nsu = orderNsu;
  if (cliente) payload.customer = cliente;
  if (webhookUrl) {
    payload.webhook = {
      url: webhookUrl,
      events: ['created', 'paid', 'settled', 'canceled', 'refunded', 'payment_failed'],
    };
  }
  if (validUntil) payload.options.valid_until = validUntil;

  const res = await fetch(`${BASE}/links`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || (typeof data === 'string' ? data : '') || `Infinitepay HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Consulta manual do status de um pagamento
export async function consultarPagamento(env, { orderNsu, transactionNsu, slug }) {
  const res = await fetch(`${BASE}/payment_check`, {
    method: 'POST',
    headers: headers(env),
    body: JSON.stringify({
      handle: env.PAYMENT_HANDLE || 'droppfy',
      order_nsu: orderNsu,
      transaction_nsu: transactionNsu,
      slug,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || `Infinitepay HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
