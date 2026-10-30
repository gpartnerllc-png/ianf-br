const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-Id',
  'Access-Control-Max-Age': '86400',
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

export function err(message, status = 400, code = 'BAD_REQUEST') {
  return json({ ok: false, error: { code, message } }, status);
}

export function ok(data = {}) {
  return json({ ok: true, ...data });
}

export function getIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

export function onlyNumbers(v) {
  return String(v || '').replace(/\D/g, '');
}

export function isValidCnpj(cnpj) {
  const c = onlyNumbers(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    let sum = 0, pos = len - 7;
    for (let i = 0; i < len; i++) {
      sum += parseInt(c[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === parseInt(c[12]) && calc(13) === parseInt(c[13]);
}

export function isValidCpf(cpf) {
  const c = onlyNumbers(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(c[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(c[9]) && calc(10) === parseInt(c[10]);
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').toLowerCase().trim());
}

export function randomId(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function audit(env, { userId = null, email = '', acao, detalhe = '', ip }) {
  try {
    await env.DB.prepare(
      'INSERT INTO auditoria (user_id, email, acao, detalhe, ip) VALUES (?, ?, ?, ?, ?)'
    ).bind(userId, email, acao, detalhe.slice(0, 500), ip).run();
  } catch (e) {
    console.error('audit fail:', e.message);
  }
}

const RATE_WINDOW = 60;
const RATE_LIMITS = { default: 60, login: 10, ai: 10, cnpj: 30, serasa: 10, apibrasil: 20 };

export async function rateLimit(env, ip, key = 'default') {
  const limit = RATE_LIMITS[key] || RATE_LIMITS.default;
  const bucket = `rl:${key}:${ip}`;
  const current = parseInt(await env.KV.get(bucket)) || 0;
  if (current >= limit) return false;
  await env.KV.put(bucket, String(current + 1), { expirationTtl: RATE_WINDOW });
  return true;
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
