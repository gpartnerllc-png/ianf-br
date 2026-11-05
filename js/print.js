// ============================================================
// IANF - Módulo de Impressão
// DANFE A4 | Térmica 80mm (ESC/POS + CSS) | Etiquetas (ZPL + CSS)
// ============================================================

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const agora = () => new Date().toLocaleString('pt-BR');

export const Print = {
  _dados() {
    const endereco = {
      endereco: document.getElementById('endInput')?.value || '',
      numero: document.getElementById('numInput')?.value || '',
      bairro: document.getElementById('bairroInput')?.value || '',
      cidade: document.getElementById('cidadeInput')?.value || '',
      uf: document.getElementById('ufInput')?.value || '',
      pais: document.getElementById('paisInput')?.value || 'Brasil',
    };
    endereco.linha1 = [endereco.endereco, endereco.numero ? `Nº ${endereco.numero}` : ''].filter(Boolean).join(', ');
    endereco.linha2 = [endereco.bairro, [endereco.cidade, endereco.uf].filter(Boolean).join(' - '), endereco.pais].filter(Boolean).join(', ');
    return {
      valor: parseFloat(document.getElementById('valorInput')?.value) || 0,
      slot: document.getElementById('slotDestino')?.value || 'outros',
      doc: document.getElementById('docInput')?.value || '',
      nome: document.getElementById('nomeInput')?.value || 'Cliente',
      email: document.getElementById('emailInput')?.value || '',
      tel: document.getElementById('telInput')?.value || '',
      desc: document.getElementById('descInput')?.value || 'Serviços prestados',
      itens: window._itens || [],
      endereco,
    };
  },

  // ==================== DANFE A4 ====================
  danfeA4() {
    const d = this._dados();
    if (d.valor <= 0) return alert('Informe o valor antes de imprimir.');
    const cbs = d.valor * 0.009, ibs = d.valor * 0.001;
    const area = document.getElementById('print-a4');
    area.innerHTML = `
      <style>
        .danfe { font-family: 'Courier New', monospace; color: #000; font-size: 11px; max-width: 720px; margin: 0 auto; }
        .danfe .head { display: flex; justify-content: space-between; border: 1.5px solid #000; padding: 8px; margin-bottom: 6px; }
        .danfe h1 { font-size: 16px; margin: 0; }
        .danfe table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        .danfe td, .danfe th { border: 1px solid #000; padding: 4px 6px; text-align: left; }
        .danfe .total { font-size: 15px; font-weight: bold; }
        .danfe .fiscal { border: 1.5px solid #000; padding: 6px; margin-top: 8px; }
        .danfe .ass { display: flex; justify-content: space-between; margin-top: 42px; text-align: center; }
        .danfe .linha { border-top: 1px solid #000; width: 180px; display: inline-block; }
      </style>
      <div class="danfe">
        <div class="head">
          <div>
            <h1>IANF - SISTEMA DE BALANÇOS</h1>
            <b>DANFE Simplificado - Documento Auxiliar</b><br>
            Reforma Tributária 2026 &middot; CBS + IBS
          </div>
          <div style="text-align:right">
            <b>Nº ${String(Math.floor(100000 + Math.random() * 900000))}</b><br>
            Série 1 &middot; Emissão: ${agora()}
          </div>
        </div>
        <table>
          <tr><th style="width:140px">DESTINATÁRIO</th><td>${this._esc(d.nome)}</td></tr>
          <tr><th>CPF/CNPJ</th><td>${this._esc(d.doc) || 'Não informado'}</td></tr>
          <tr><th>CONTATO</th><td>${this._esc(d.email)} ${this._esc(d.tel)}</td></tr>
          ${d.endereco.linha1 ? `<tr><th>ENDEREÇO</th><td>${this._esc(d.endereco.linha1)}</td></tr>` : ''}
          ${d.endereco.linha2 ? `<tr><th>CIDADE</th><td>${this._esc(d.endereco.linha2)}</td></tr>` : ''}
        </table>
        <table>
          <tr><th>DESCRIÇÃO DO ATIVO / SERVIÇO</th><th style="width:120px">VALOR (R$)</th></tr>
          ${(d.itens.length ? d.itens : [{ descricao: d.desc }]).map((i) => `
            <tr><td>${this._esc(i.descricao)}</td><td style="text-align:right">${fmt(i.preco)}</td></tr>`).join('')}
          <tr><td class="total" colspan="1">TOTAL</td><td class="total" style="text-align:right">${fmt(d.valor)}</td></tr>
        </table>
        <div class="fiscal">
          <b>TRIBUTAÇÃO - REFORMA TRIBUTÁRIA 2026</b><br>
          CBS (Contribuição sobre Bens e Serviços - Federal): ${fmt(cbs)}<br>
          IBS (Imposto sobre Bens e Serviços - Estado/Município): ${fmt(ibs)}<br>
          Valor Líquido: ${fmt(d.valor)}
        </div>
        <div class="ass">
          <span class="linha"></span>
          <span class="linha"></span>
        </div>
      </div>`;
    window.print();
  },

  // ==================== TÉRMICA 80mm ====================
  termica80mm() {
    const d = this._dados();
    if (d.valor <= 0) return alert('Informe o valor antes de imprimir.');
    const area = document.getElementById('print-termico');
    const linhas = this._reciboLinhas(d);
    area.innerHTML = `
      <style>
        .recibo { width: 72mm; margin: 0; padding: 3mm; font-family: 'Courier New', monospace; font-size: 11px; color: #000; background: #fff; }
        .recibo .center { text-align: center; }
        .recibo .sep { border-top: 1px dashed #000; margin: 5px 0; }
        .recibo .grande { font-size: 15px; font-weight: bold; }
        .recibo table { width: 100%; }
        .recibo .total { font-size: 16px; font-weight: bold; }
      </style>
      <div class="recibo">${linhas}</div>`;

    // Tenta impressão direta via ESC/POS (WebUSB) se houver impressora
    if (navigator.usb) {
      this._printEscPos(d).then((ok) => {
        if (!ok) window.print();
      });
    } else {
      window.print();
    }
  },

  _reciboLinhas(d) {
    const cbs = d.valor * 0.009, ibs = d.valor * 0.001;
    return `
      <div class="center grande">IANF</div>
      <div class="center">SISTEMA DE BALANÇOS</div>
      <div class="sep"></div>
      <div class="center">${agora()}</div>
      <div class="sep"></div>
      <div>CLIENTE: ${this._esc(d.nome)}</div>
      ${d.doc ? `<div>DOC: ${this._esc(d.doc)}</div>` : ''}
      ${d.endereco.linha1 ? `<div>END: ${this._esc(d.endereco.linha1)}</div>` : ''}
      ${d.endereco.linha2 ? `<div>${this._esc(d.endereco.linha2)}</div>` : ''}
      <div class="sep"></div>
      ${(d.itens.length ? d.itens : [{ descricao: d.desc }]).map((i) =>
        `<table><tr><td>${this._esc((i.descricao || '').slice(0, 26))}</td><td style="text-align:right">${fmt(i.preco)}</td></tr></table>`).join('')}
      <div class="sep"></div>
      <table>
        <tr><td>CBS (0,9%)</td><td style="text-align:right">${fmt(cbs)}</td></tr>
        <tr><td>IBS (0,1%)</td><td style="text-align:right">${fmt(ibs)}</td></tr>
      </table>
      <div class="sep"></div>
      <div class="center total">TOTAL: ${fmt(d.valor)}</div>
      <div class="sep"></div>
      <div class="center">Reforma Tributaria 2026<br>Documento sem valor fiscal<br>Guarde este comprovante</div>
      <div class="sep"></div>
      <div class="center">Obrigado pela preferencia!</div>`;
  },

  // ==================== ETIQUETA ZPL ====================
  etiquetaZPL() {
    const d = this._dados();
    if (d.valor <= 0) return alert('Informe o valor antes de imprimir.');
    const zpl = this._gerarZPL(d);

    const area = document.getElementById('print-etiqueta');
    area.innerHTML = `
      <style>
        .etiqueta { width: 100mm; padding: 5mm; border: 1px solid #000; font-family: monospace; font-size: 12px; color: #000; background: #fff; }
        .etiqueta .code { font-size: 9px; letter-spacing: 1px; }
        .etiqueta .barcode { font-family: 'Libre Barcode 128', monospace; font-size: 34px; }
      </style>
      <div class="etiqueta">
        <b>IANF - ${this._esc(d.slot.toUpperCase())}</b><br>
        <span class="code">${this._esc((d.desc || '').slice(0, 40))}</span><br>
        <b>${fmt(d.valor)}</b> &middot; ${agora()}<br>
        <span class="barcode">${this._code128Visual(d.valor)}</span>
      </div>`;

    if (navigator.usb) {
      this._printZpl(zpl).then((ok) => {
        if (!ok) window.print();
      });
    } else {
      window.print();
    }
  },

  // ----- ZPL para impressoras Zebra / compatíveis -----
  _gerarZPL(d) {
    const texto = `IANF ${d.slot} ${fmt(d.valor)}`;
    const code128 = this._code128Bytes(texto);
    let data = '';
    for (const b of code128) data += String.fromCharCode(b);
    // ^BC com modo D (bar code interleaved? nao: mode ^BCo,h,f,g,e,m - data codificada em ^FD deve ser Code128 pré-gerado com caracteres de controle
    return [
      '^XA',
      '^PW812',
      '^FO30,30^A0N,38,38^FD' + this._esc((d.desc || '').slice(0, 30)).toUpperCase() + '^FS',
      '^FO30,80^A0N,30,30^FDVALOR: ' + fmt(d.valor).toUpperCase() + '^FS',
      '^FO30,125^A0N,25,25^FD' + agora().toUpperCase() + '^FS',
      '^FO30,170^BCN,70,Y,N,N^FD' + data + '^FS',
      '^FO30,260^A0N,22,22^FD' + this._esc((d.doc || 'IANF')).toUpperCase() + '^FS',
      '^XZ',
    ].join('\n');
  },

  _code128Bytes(texto) {
    // Gera símbolos Code128 (subset B) incluindo checksum
    const bytes = [];
    const B_START = 104, STOP = 106;
    const push = (v) => bytes.push(v);
    const val = (ch) => ch.charCodeAt(0) - 32;
    push(B_START);
    let sum = B_START;
    for (let i = 0; i < texto.length; i++) {
      const v = val(texto[i]);
      if (v < 0 || v > 94) continue;
      push(v);
      sum += v * (i + 1);
    }
    push(sum % 103);
    push(STOP);
    return bytes;
  },

  _code128Visual(valor) {
    const sym = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
    return this._code128Bytes(String(valor)).map((b) => sym[b % sym.length]).join('');
  },

  // ----- ESC/POS (impressoras térmicas Epson/Elgin/Bematech etc.) -----
  _escPosBytes(d) {
    const out = [];
    const esc = (cmd) => out.push(0x1b, ...cmd);
    const text = (s) => {
      for (const ch of String(s).normalize('NFKD')) {
        const c = ch.charCodeAt(0);
        if (c < 256) out.push(c);
      }
    };

    esc([0x40]); // init
    esc([0x61, 1]); // alinhamento centro
    esc([0x21, 0x30]); // fonte grande
    text('IANF');
    out.push(0x0a);
    esc([0x21, 0x00]); // fonte normal
    text('SISTEMA DE BALANCOS');
    out.push(0x0a);
    esc([0x61, 0]); // esquerda
    text('--------------------------------');
    out.push(0x0a);
    text('DATA: ' + agora());
    out.push(0x0a);
    text('CLIENTE: ' + (d.nome || '').slice(0, 30));
    out.push(0x0a);
    if (d.doc) { text('DOC: ' + d.doc); out.push(0x0a); }
    if (d.endereco.linha1) { text('END: ' + d.endereco.linha1.slice(0, 40)); out.push(0x0a); }
    if (d.endereco.linha2) { text(d.endereco.linha2.slice(0, 40)); out.push(0x0a); }
    text('--------------------------------');
    out.push(0x0a);
    for (const i of (d.itens.length ? d.itens : [{ descricao: d.desc, preco: d.valor }])) {
      text((i.descricao || '').slice(0, 28));
      out.push(0x0a);
      esc([0x61, 2]); // direita
      text(fmt(i.preco));
      out.push(0x0a);
      esc([0x61, 0]);
    }
    text('--------------------------------');
    out.push(0x0a);
    text('CBS (0,9%):  ' + fmt(d.valor * 0.009));
    out.push(0x0a);
    text('IBS (0,1%):  ' + fmt(d.valor * 0.001));
    out.push(0x0a);
    esc([0x21, 0x38]); // negrito + grande
    text('TOTAL: ' + fmt(d.valor));
    out.push(0x0a);
    esc([0x21, 0x00]);
    text('--------------------------------');
    out.push(0x0a);
    esc([0x61, 1]);
    text('Reforma Tributaria 2026');
    out.push(0x0a);
    text('Obrigado pela preferencia!');
    out.push(0x0a);
    esc([0x61, 0]);
    // código de barras Code128 do valor
    const code = this._code128Bytes(fmt(d.valor).replace(/[^\d.,]/g, ''));
    esc([0x1d, 0x6b, 0x49, code.length]);
    out.push(...code);
    out.push(0x0a, 0x0a);
    out.push(0x0a, 0x0a, 0x0a); // 3 linhas
    esc([0x1d, 0x56, 0x42, 0x00]); // corte parcial
    return new Uint8Array(out);
  },

  async _printEscPos(d) {
    try {
      const device = await this._getDevice([
        { vendorId: 0x04b8 }, // Epson
        { vendorId: 0x0ef6 }, // Elgin
        { vendorId: 0x067b }, // Bematech
        { vendorId: 0x0a5f }, // Zebra
        { vendorId: 0x0416 }, // genérico térmica
      ]);
      if (!device) return false;
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      const bytes = this._escPosBytes(d);
      await device.transferOut(1, bytes);
      await device.close();
      window._log('IMPRESSORA TÉRMICA: comando ESC/POS enviado.');
      return true;
    } catch (e) {
      window._log('Impressão direta indisponível (' + e.message + ') - usando diálogo do sistema.');
      return false;
    }
  },

  async _printZpl(zpl) {
    try {
      const device = await this._getDevice([
        { vendorId: 0x0a5f }, // Zebra
        { vendorId: 0x04b8 }, // Epson (label)
        { vendorId: 0x03f0 }, // HP (label)
      ]);
      if (!device) return false;
      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);
      await device.transferOut(1, new TextEncoder().encode(zpl));
      await device.close();
      window._log('ETIQUETA: comando ZPL enviado à impressora.');
      return true;
    } catch (e) {
      window._log('Impressão direta indisponível - usando diálogo do sistema.');
      return false;
    }
  },

  async _getDevice(filters) {
    const existing = await navigator.usb.getDevices();
    if (existing.length) return existing[0];
    try {
      return await navigator.usb.requestDevice({ filters });
    } catch {
      return null;
    }
  },

  _esc(s) {
    return String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  },
};

window.Print = Print;
