import { json, ok, err, readBody, audit, getIp } from '../lib/utils.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';

function toPublic(u) {
  return { id: u.id, email: u.email, name: u.name, doc: u.doc, role: u.role, status: u.status, last_login: u.last_login, created_at: u.created_at };
}

export async function handleUsers(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const adminErr = requireAdmin(auth.user);
  if (adminErr) return adminErr;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM users ORDER BY id').all();
    return ok({ users: results.map(toPublic) });
  }
  return err('Método não suportado.', 405, 'METODO');
}

export async function handleUserItem(env, request, id) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const adminErr = requireAdmin(auth.user);
  if (adminErr) return adminErr;

  const alvo = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  if (!alvo) return err('Usuário não encontrado.', 404, 'NAO_ENCONTRADO');
  if (alvo.id === auth.user.id) return err('Você não pode alterar a própria conta por aqui.', 400, 'ACAO_PROPRIA');

  const body = await readBody(request);

  // Aprovar / bloquear / promover
  if (request.method === 'PUT') {
    if (body.status && !['pending', 'active', 'blocked'].includes(body.status)) return err('Status inválido.', 400, 'STATUS_INVALIDO');
    if (body.role && !['admin', 'operator'].includes(body.role)) return err('Papel inválido.', 400, 'ROLE_INVALIDO');
    await env.DB.prepare('UPDATE users SET status = COALESCE(?, status), role = COALESCE(?, role) WHERE id = ?')
      .bind(body.status ?? null, body.role ?? null, id).run();
    const atualizado = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'USER_ATUALIZADO', detalhe: `${alvo.email} -> status=${atualizado.status} role=${atualizado.role}`, ip: getIp(request) });
    return ok({ user: toPublic(atualizado) });
  }

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'USER_REMOVIDO', detalhe: alvo.email, ip: getIp(request) });
    return ok({ message: 'Usuário removido.' });
  }

  return err('Método não suportado.', 405, 'METODO');
}

export async function handleAuditoria(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const adminErr = requireAdmin(auth.user);
  if (adminErr) return adminErr;

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
  const { results } = await env.DB.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT ?').bind(limit).all();
  return ok({ eventos: results });
}

export async function handleMetricas(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const adminErr = requireAdmin(auth.user);
  if (adminErr) return adminErr;

  const [users, lancamentos, notas, empresas, auditoriaHoje] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS c FROM users').first(),
    env.DB.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(CASE WHEN tipo=\'receita\' THEN valor END),0) AS receita, COALESCE(SUM(CASE WHEN tipo=\'despesa\' THEN valor END),0) AS despesa FROM lancamentos').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM notas').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM empresas').first(),
    env.DB.prepare("SELECT COUNT(*) AS c FROM auditoria WHERE created_at >= strftime('%Y-%m-%dT00:00:00Z','now')").first(),
  ]);

  return ok({
    usuarios: users.c,
    lancamentos: lancamentos.c,
    receitaTotal: lancamentos.receita || 0,
    despesaTotal: lancamentos.despesa || 0,
    notas: notas.c,
    empresas: empresas.c,
    eventosHoje: auditoriaHoje.c,
  });
}
