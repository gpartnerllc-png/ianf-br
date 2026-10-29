import { json, ok, err, readBody, isValidEmail, onlyNumbers, isValidCpf, isValidCnpj, audit, getIp, rateLimit } from '../lib/utils.js';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth } from '../lib/auth.js';

const PUBLIC_FIELDS = ['id', 'email', 'name', 'doc', 'role', 'status', 'last_login', 'created_at'];

function toPublic(user) {
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = user[f];
  return out;
}

export async function handleRegister(env, request) {
  const ip = getIp(request);
  if (!(await rateLimit(env, ip, 'login'))) return err('Muitas tentativas. Aguarde 1 minuto.', 429, 'RATE_LIMIT');

  const body = await readBody(request);
  const email = String(body.email || '').toLowerCase().trim();
  const pass = String(body.pass || '');
  const name = String(body.name || '').trim();
  const doc = onlyNumbers(body.doc);

  if (!isValidEmail(email)) return err('E-mail inválido.', 400, 'EMAIL_INVALIDO');
  if (pass.length < 8) return err('A senha deve ter no mínimo 8 caracteres.', 400, 'SENHA_FRACA');
  if (doc && doc.length !== 11 && doc.length !== 14) return err('CPF/CNPJ inválido.', 400, 'DOC_INVALIDO');
  if (doc && doc.length === 11 && !isValidCpf(doc)) return err('CPF inválido.', 400, 'CPF_INVALIDO');
  if (doc && doc.length === 14 && !isValidCnpj(doc)) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return err('Este e-mail já está cadastrado.', 409, 'EMAIL_EXISTENTE');

  const passHash = await hashPassword(pass, null, env);
  const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  const role = count.c === 0 ? 'admin' : 'operator';
  const status = count.c === 0 ? 'active' : 'pending';

  const result = await env.DB.prepare(
    'INSERT INTO users (email, pass_hash, name, doc, role, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(email, passHash, name, doc, role, status).run();

  await audit(env, { userId: result.meta.last_row_id, email, acao: 'REGISTRO', detalhe: `Novo usuário (${role})`, ip });

  if (role === 'admin') {
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(result.meta.last_row_id).first();
    const token = await createSession(env, user);
    return ok({ message: 'Administrador criado.', token, user: toPublic(user) });
  }
  return ok({ message: 'Cadastro recebido! Aguarde a aprovação do administrador.', pending: true });
}

export async function handleLogin(env, request) {
  const ip = getIp(request);
  if (!(await rateLimit(env, ip, 'login'))) return err('Muitas tentativas de login. Aguarde 1 minuto.', 429, 'RATE_LIMIT');

  const body = await readBody(request);
  const email = String(body.email || '').toLowerCase().trim();
  const pass = String(body.pass || '');

  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    // Garante a criação do admin antes de negar (o bootstrap assíncrono pode não ter terminado na 1ª chamada)
    await bootstrapAdmin(env);
    user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  }
  if (!user) return err('Credenciais inválidas.', 401, 'CREDENCIAIS_INVALIDAS');

  const valid = await verifyPassword(pass, user.pass_hash, env);
  if (!valid) {
    await audit(env, { userId: user.id, email, acao: 'LOGIN_FALHA', detalhe: 'Senha incorreta', ip });
    return err('Credenciais inválidas.', 401, 'CREDENCIAIS_INVALIDAS');
  }
  if (user.status === 'blocked') return err('Conta bloqueada pelo administrador.', 403, 'BLOQUEADO');
  if (user.status === 'pending') return err('Conta aguardando aprovação do administrador.', 403, 'PENDENTE');

  await env.DB.prepare("UPDATE users SET last_login = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(user.id).run();
  const token = await createSession(env, user);
  await audit(env, { userId: user.id, email, acao: 'LOGIN', detalhe: 'Acesso autorizado', ip });
  return ok({ token, user: toPublic(user) });
}

export async function handleLogout(env, request) {
  const auth = await requireAuth(env, request);
  if (!auth.error) {
    await destroySession(env, auth.token);
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'LOGOUT', ip: getIp(request) });
  }
  return ok({ message: 'Sessão encerrada.' });
}

export async function handleMe(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  return ok({ user: toPublic(auth.user) });
}

export async function handleTrocarSenha(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const body = await readBody(request);
  const atual = String(body.atual || '');
  const nova = String(body.nova || '');
  const valid = await verifyPassword(atual, auth.user.pass_hash, env);
  if (!valid) return err('Senha atual incorreta.', 401, 'SENHA_ATUAL');
  if (nova.length < 8) return err('A nova senha deve ter no mínimo 8 caracteres.', 400, 'SENHA_FRACA');
  const passHash = await hashPassword(nova, null, env);
  await env.DB.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').bind(passHash, auth.user.id).run();
  await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'SENHA_ALTERADA', ip: getIp(request) });
  return ok({ message: 'Senha alterada com sucesso.' });
}

export async function bootstrapAdmin(env) {
  try {
    const count = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
    if (count.c > 0) return;
    const email = env.ADMIN_EMAIL;
    const pass = env.ADMIN_PASSWORD;
    if (!email || !pass) {
      console.warn('[IANF] Sem ADMIN_EMAIL/ADMIN_PASSWORD definidos - o primeiro registro vira admin.');
      return;
    }
    const passHash = await hashPassword(pass, null, env);
    await env.DB.prepare(
      "INSERT INTO users (email, pass_hash, name, doc, role, status) VALUES (?, ?, 'Administrador', '', 'admin', 'active')"
    ).bind(String(email).toLowerCase().trim(), passHash).run();
    console.log('[IANF] Administrador inicial criado.');
  } catch (e) {
    console.error('[IANF] Falha no bootstrap do admin:', e.message);
  }
}
