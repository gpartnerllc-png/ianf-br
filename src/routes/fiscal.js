import { json, ok, err, readBody, audit, getIp } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { calcularFiscal, resumoDRE, REGIMES } from '../lib/fiscal.js';
import { classificarLancamento } from '../lib/ai.js';
import { syncFinalizarVenda } from '../lib/lambda.js';

const SLOTS = {
  receita_pix: 'Pix', receita_cartao: 'Cartão',
  obras: 'Obras', energia: 'Energia', manutencao: 'Manutenção', equipamentos: 'Equipamentos',
  pro_labore: 'Pró-labore', func: 'Funcionários', taxas: 'Taxas/Impostos', servicos: 'Serviços', outros: 'Outros',
};

export async function handleCalcular(env, request) {
  const body = await readBody(request);
  const valor = Number(body.valor);
  const regime = String(body.regime || 'mei');
  if (!Number.isFinite(valor) || valor < 0) return err('Valor inválido.', 400, 'VALOR_INVALIDO');
  const fiscal = calcularFiscal(valor, regime, body.cbs, body.ibs, env);
  return ok({ fiscal });
}

export async function handleRegimes(env) {
  return ok({ regimes: REGIMES });
}

export async function handleDre(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const { results: lancamentos } = await env.DB.prepare(
    'SELECT tipo, slot, valor, descricao, created_at FROM lancamentos WHERE user_id = ? ORDER BY created_at DESC LIMIT 2000'
  ).bind(auth.user.id).all();

  const dre = resumoDRE(lancamentos);

  // Série dos últimos 14 dias
  const dias = [];
  const hoje = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dias.push({ data: key, receita: 0, despesa: 0 });
  }
  const mapa = new Map(dias.map((d) => [d.data, d]));
  for (const l of lancamentos) {
    const key = (l.created_at || '').slice(0, 10);
    const dia = mapa.get(key);
    if (!dia) continue;
    if (l.tipo === 'receita') dia.receita += l.valor;
    else if (l.tipo === 'despesa') dia.despesa += l.valor;
  }

  // Por categoria
  const porCategoria = {};
  for (const l of lancamentos) {
    const nome = SLOTS[l.slot] || l.slot;
    porCategoria[nome] = (porCategoria[nome] || 0) + l.valor;
  }

  return ok({ dre, serie: dias, porCategoria, totalLancamentos: lancamentos.length });
}

// Balancete: totais de hoje com comparativos D-1 (ontem), M-1 (mês anterior) e Y-1 (ano anterior)
export async function handleDreComparativo(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  const inicioAnoAnterior = new Date(Date.UTC(new Date().getUTCFullYear() - 1, 0, 1));
  const { results: lancamentos } = await env.DB.prepare(
    'SELECT tipo, slot, valor, created_at FROM lancamentos WHERE user_id = ? AND created_at >= ? ORDER BY created_at ASC LIMIT 10000'
  ).bind(auth.user.id, inicioAnoAnterior.toISOString()).all();

  const agora = new Date();
  const inicioHoje = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate()));
  const inicioOntem = new Date(inicioHoje.getTime() - 86400000);
  const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  const inicioMesAnterior = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - 1, 1));
  const inicioAno = new Date(Date.UTC(agora.getUTCFullYear(), 0, 1));

  const vazio = () => ({ receita: 0, despesa: 0, investimento: 0 });
  const buckets = {
    hoje: vazio(), d1: vazio(), m1: vazio(), y1: vazio(),
  };
  const porSlot = {};

  const somaTipo = (acc, tipo, valor) => {
    if (tipo === 'receita') acc.receita += valor;
    else if (tipo === 'despesa') acc.despesa += valor;
    else if (tipo === 'investimento') acc.investimento += valor;
  };

  for (const l of lancamentos) {
    const dt = new Date(l.created_at || '');
    if (Number.isNaN(dt.getTime())) continue;
    const nome = SLOTS[l.slot] || l.slot || 'Outros';
    porSlot[nome] = porSlot[nome] || { hoje: vazio(), d1: vazio(), m1: vazio(), y1: vazio() };
    let alvo = null;
    if (dt >= inicioHoje) alvo = 'hoje';
    else if (dt >= inicioOntem) alvo = 'd1';
    else if (dt >= inicioMesAnterior && dt < inicioMes) alvo = 'm1';
    else if (dt >= inicioAnoAnterior && dt < inicioAno) alvo = 'y1';
    if (!alvo) continue;
    somaTipo(buckets[alvo], l.tipo, l.valor);
    somaTipo(porSlot[nome][alvo], l.tipo, l.valor);
  }

  return ok({
    hoje: buckets.hoje,
    comparativos: { d1: buckets.d1, m1: buckets.m1, y1: buckets.y1 },
    porSlot,
    labels: {
      d1: inicioOntem.toLocaleDateString('pt-BR', { timeZone: 'UTC' }),
      m1: inicioMesAnterior.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      y1: String(agora.getUTCFullYear() - 1),
    },
  });
}

export async function handleLancamentos(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);

  // Listar (paginação simples)
  if (request.method === 'GET') {
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    const { results } = await env.DB.prepare(
      'SELECT * FROM lancamentos WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
    ).bind(auth.user.id, limit, offset).all();
    return ok({ lancamentos: results });
  }

  // Criar
  if (request.method === 'POST') {
    const body = await readBody(request);
    let { tipo, slot, valor, descricao } = body;
    valor = Number(valor);
    if (!['receita', 'despesa', 'investimento'].includes(tipo)) return err('Tipo inválido.', 400, 'TIPO_INVALIDO');
    if (!Number.isFinite(valor) || valor <= 0) return err('Valor inválido.', 400, 'VALOR_INVALIDO');

    // IA sugere classificação quando não informada
    if ((!tipo || !slot) && descricao) {
      const ia = await classificarLancamento(env, descricao);
      if (ia.ok) {
        if (!tipo) tipo = ia.tipo;
        if (!slot) slot = ia.slot;
      }
    }
    tipo = tipo || 'despesa';
    slot = slot || 'outros';

    const result = await env.DB.prepare(
      'INSERT INTO lancamentos (user_id, tipo, slot, valor, descricao, doc_cliente, nome_cliente) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(auth.user.id, tipo, slot, valor, String(descricao || '').slice(0, 500), body.doc_cliente || '', body.nome_cliente || '').run();

    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'LANCAMENTO_CRIADO', detalhe: `${tipo} ${slot} R$ ${valor}`, ip: getIp(request) });

    // Vendas (receitas) também sincronizam com o núcleo legado (AWS Lambda).
    // Cobranças de assinatura ficam fora: o núcleo legado não possui o slot.
    if (tipo === 'receita' && slot !== 'assinatura') {
      syncFinalizarVenda(env, {
        nome: body.nome_cliente || '',
        valor,
        documento: body.doc_cliente || '',
        slot_dre: slot,
      });
    }

    const lanc = await env.DB.prepare('SELECT * FROM lancamentos WHERE id = ?').bind(result.meta.last_row_id).first();
    return ok({ lancamento: lanc });
  }

  return err('Método não suportado.', 405, 'METODO');
}

export async function handleLancamentoItem(env, request, id) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  const lanc = await env.DB.prepare('SELECT * FROM lancamentos WHERE id = ? AND user_id = ?').bind(id, auth.user.id).first();
  if (!lanc) return err('Lançamento não encontrado.', 404, 'NAO_ENCONTRADO');

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM lancamentos WHERE id = ?').bind(id).run();
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'LANCAMENTO_REMOVIDO', detalhe: `id ${id} R$ ${lanc.valor}`, ip: getIp(request) });
    return ok({ message: 'Lançamento removido.' });
  }

  if (request.method === 'PUT') {
    const body = await readBody(request);
    const valor = Number(body.valor ?? lanc.valor);
    if (!Number.isFinite(valor) || valor <= 0) return err('Valor inválido.', 400, 'VALOR_INVALIDO');
    await env.DB.prepare('UPDATE lancamentos SET valor = ?, descricao = ?, slot = ? WHERE id = ?')
      .bind(valor, String(body.descricao ?? lanc.descricao).slice(0, 500), body.slot || lanc.slot, id).run();
    const atualizado = await env.DB.prepare('SELECT * FROM lancamentos WHERE id = ?').bind(id).first();
    return ok({ lancamento: atualizado });
  }

  return err('Método não suportado.', 405, 'METODO');
}

export async function handleEmpresas(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  if (request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM empresas WHERE user_id = ? ORDER BY id DESC').bind(auth.user.id).all();
    return ok({ empresas: results });
  }

  if (request.method === 'POST') {
    const body = await readBody(request);
    const cnpj = String(body.cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) return err('CNPJ inválido.', 400, 'CNPJ_INVALIDO');
    const regime = ['mei', 'simples', 'padrao', 'personalizado'].includes(body.regime) ? body.regime : 'mei';
    const result = await env.DB.prepare(
      'INSERT INTO empresas (user_id, cnpj, razao_social, nome_fantasia, regime, cbs_rate, ibs_rate, email, phone, cnae, uf, municipio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(auth.user.id, cnpj, body.razao_social || '', body.nome_fantasia || '', regime,
      body.cbs_rate ?? null, body.ibs_rate ?? null, body.email || '', body.phone || '', body.cnae || '', body.uf || '', body.municipio || '').run();
    const empresa = await env.DB.prepare('SELECT * FROM empresas WHERE id = ?').bind(result.meta.last_row_id).first();
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'EMPRESA_CRIADA', detalhe: cnpj, ip: getIp(request) });
    return ok({ empresa });
  }

  return err('Método não suportado.', 405, 'METODO');
}

export async function handleEmpresaItem(env, request, id) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const empresa = await env.DB.prepare('SELECT * FROM empresas WHERE id = ? AND user_id = ?').bind(id, auth.user.id).first();
  if (!empresa) return err('Empresa não encontrada.', 404, 'NAO_ENCONTRADO');

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM empresas WHERE id = ?').bind(id).run();
    return ok({ message: 'Empresa removida.' });
  }

  if (request.method === 'PUT') {
    const body = await readBody(request);
    await env.DB.prepare(
      'UPDATE empresas SET regime = ?, cbs_rate = ?, ibs_rate = ?, razao_social = ?, nome_fantasia = ?, email = ?, phone = ? WHERE id = ?'
    ).bind(body.regime || empresa.regime, body.cbs_rate ?? empresa.cbs_rate, body.ibs_rate ?? empresa.ibs_rate,
      body.razao_social || empresa.razao_social, body.nome_fantasia || empresa.nome_fantasia,
      body.email || empresa.email, body.phone || empresa.phone, id).run();
    const atualizada = await env.DB.prepare('SELECT * FROM empresas WHERE id = ?').bind(id).first();
    return ok({ empresa: atualizada });
  }

  return err('Método não suportado.', 405, 'METODO');
}
