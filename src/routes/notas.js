import { json, ok, err, readBody, audit, getIp, onlyNumbers } from '../lib/utils.js';
import { requireAuth } from '../lib/auth.js';
import { spedy, montarOrderPayload, montarNfsePayload } from '../lib/spedy.js';
import { calcularFiscal } from '../lib/fiscal.js';

export async function handleNotas(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const tipo = url.searchParams.get('tipo') || '';
    const { results } = await env.DB.prepare(
      `SELECT * FROM notas WHERE user_id = ? ${tipo ? 'AND tipo = ?' : ''} ORDER BY id DESC LIMIT 100`
    ).bind(...(tipo ? [auth.user.id, tipo] : [auth.user.id])).all();
    return ok({ notas: results });
  }

  // Emissão de nota (rascunho local + emissão real via Spedy quando configurada)
  if (request.method === 'POST') {
    const body = await readBody(request);
    const tipo = ['nfe', 'nfce', 'nfse'].includes(body.tipo) ? body.tipo : 'nfse';
    const valor = Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0) return err('Valor da nota inválido.', 400, 'VALOR_INVALIDO');

    const clienteDoc = onlyNumbers(body.doc_cliente);
    const clienteNome = String(body.nome_cliente || 'Cliente').slice(0, 120);
    const descricao = String(body.descricao || 'Serviços prestados').slice(0, 2000);
    const regime = body.regime || 'mei';
    const endereco = {
      endereco: String(body.endereco_cliente?.endereco || '').slice(0, 160),
      numero: String(body.endereco_cliente?.numero || '').slice(0, 10),
      bairro: String(body.endereco_cliente?.bairro || '').slice(0, 80),
      cidade: String(body.endereco_cliente?.cidade || '').slice(0, 80),
      uf: String(body.endereco_cliente?.uf || '').slice(0, 2).toUpperCase(),
      pais: String(body.endereco_cliente?.pais || 'Brasil').slice(0, 40),
    };
    const telefone = String(body.telefone_cliente || '').slice(0, 20);

    const fiscal = calcularFiscal(valor, regime, body.cbs, body.ibs, env);

    // 1) Registro local
    const result = await env.DB.prepare(
      `INSERT INTO notas (user_id, tipo, valor, status, provider, cliente_doc, cliente_nome, extra)
       VALUES (?, ?, ?, 'rascunho', 'ianf', ?, ?, ?)`
    ).bind(auth.user.id, tipo, valor, clienteDoc, clienteNome,
      JSON.stringify({ descricao, regime, fiscal, itens: body.itens || [], endereco_cliente: endereco, telefone_cliente: telefone })).run();
    const notaId = result.meta.last_row_id;

    // 2) Emissão real na Spedy (se configurada)
    let spedyResult = { ok: false, code: 'SPEDY_NAO_CONFIGURADO', message: 'Spedy não configurada - nota registrada como rascunho.' };
    if (tipo === 'nfse' && spedy.spedyEnabled) {
      const payload = montarNfsePayload({
        cliente: { nome: clienteNome, doc: clienteDoc || undefined, email: body.email_cliente },
        descricao,
        valor,
        cnaeCode: body.cnae,
        ibsCbs: {
          cbs: fiscal.cbs.aliquota,
          ibsEstado: fiscal.ibs.estado.aliquota,
          ibsMunicipio: fiscal.ibs.municipio.aliquota,
          cst: 0,
          classification: 1,
        },
      });
      spedyResult = await spedy.criarNfse(env, payload);
      if (spedyResult.ok && spedyResult.data?.id) {
        await env.DB.prepare("UPDATE notas SET status = 'em_processamento', provider = 'spedy', provider_id = ? WHERE id = ?")
          .bind(spedyResult.data.id, notaId).run();
      }
    }

    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'NOTA_EMITIDA', detalhe: `${tipo.toUpperCase()} R$ ${valor} - ${clienteNome}`, ip: getIp(request) });
    const nota = await env.DB.prepare('SELECT * FROM notas WHERE id = ?').bind(notaId).first();
    return ok({ nota, fiscal, spedy: spedyResult });
  }

  return err('Método não suportado.', 405, 'METODO');
}

export async function handleNotaItem(env, request, id) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const nota = await env.DB.prepare('SELECT * FROM notas WHERE id = ? AND user_id = ?').bind(id, auth.user.id).first();
  if (!nota) return err('Nota não encontrada.', 404, 'NAO_ENCONTRADO');

  if (request.method === 'GET') return ok({ nota });

  if (request.method === 'DELETE') {
    // Se existir na Spedy, cancela lá também
    let cancelamento = { ok: true, message: 'Cancelamento local.' };
    if (nota.provider === 'spedy' && nota.provider_id) {
      cancelamento = nota.tipo === 'nfse'
        ? await spedy.cancelarNfse(env, nota.provider_id)
        : await spedy.cancelarNfe(env, nota.provider_id);
    }
    await env.DB.prepare("UPDATE notas SET status = 'cancelada' WHERE id = ?").bind(id).run();
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'NOTA_CANCELADA', detalhe: `id ${id}`, ip: getIp(request) });
    return ok({ message: 'Nota cancelada.', spedy: cancelamento });
  }

  return err('Método não suportado.', 405, 'METODO');
}

// Sincroniza notas de entrada (Receita/SEFAZ via Spedy) para o banco local
export async function handleSincronizarEntradas(env, request) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;

  const resultado = await spedy.sincronizarEntradas(env);
  if (!resultado.ok) return json(resultado, 502);

  const listagem = await spedy.listarEntradasNfe(env, { limit: 50 });
  if (listagem.ok && Array.isArray(listagem.data?.items || listagem.data)) {
    const itens = listagem.data.items || listagem.data;
    let novas = 0;
    for (const item of itens.slice(0, 50)) {
      const chave = item.accessKey || item.key || null;
      const existente = chave
        ? await env.DB.prepare('SELECT id FROM notas WHERE user_id = ? AND chave = ?').bind(auth.user.id, chave).first()
        : null;
      if (existente) continue;
      await env.DB.prepare(
        `INSERT INTO notas (user_id, tipo, numero, chave, valor, status, provider, provider_id, cliente_doc, cliente_nome)
         VALUES (?, 'entrada', ?, ?, ?, 'recebida', 'spedy', ?, ?, ?)`
      ).bind(auth.user.id, item.number || null, chave, Number(item.amount || item.total || 0) || 0,
        String(item.id || ''), onlyNumbers(item.sender?.federalTaxNumber || item.issuer?.federalTaxNumber || ''), item.sender?.name || item.issuer?.name || '').run();
      novas++;
    }
    await audit(env, { userId: auth.user.id, email: auth.user.email, acao: 'ENTRADAS_SINCRONIZADAS', detalhe: `${novas} novas`, ip: getIp(request) });
    return ok({ message: `Sincronização concluída: ${novas} nota(s) de entrada importada(s).`, novas });
  }

  return ok({ message: 'Sincronização solicitada. As notas aparecerão em instantes.', novas: 0 });
}

// Consulta situação de nota na Spedy (status real na SEFAZ/prefeitura)
export async function handleConsultarNota(env, request, id) {
  const auth = await requireAuth(env, request);
  if (auth.error) return auth.error;
  const nota = await env.DB.prepare('SELECT * FROM notas WHERE id = ? AND user_id = ?').bind(id, auth.user.id).first();
  if (!nota || nota.provider !== 'spedy' || !nota.provider_id) {
    return err('Nota não vinculada à Spedy.', 400, 'SEM_VINCULO');
  }
  const consulta = nota.tipo === 'nfse'
    ? await spedy.consultarNfse(env, nota.provider_id)
    : await spedy.consultarNfe(env, nota.provider_id);
  if (consulta.ok) {
    const status = consulta.data?.status || 'em_processamento';
    await env.DB.prepare('UPDATE notas SET status = ? WHERE id = ?').bind(status, id).run();
  }
  return json(consulta, consulta.ok ? 200 : 502);
}
