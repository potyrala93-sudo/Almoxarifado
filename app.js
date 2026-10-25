/* =========================================================
   Estoque Almoxarifado — Entrada, Estoque e Retirada
   Organização: Categoria > Produto > Tamanho/tipo (o saldo é por tamanho/tipo).
   Banco: o mesmo Supabase do App de Compras. Sem login: abre direto.
   ========================================================= */
(function () {
  'use strict';

  // ---------- Configuração ----------
  const LOCAL = window.ALMOX_CONFIG || {};
  const COMPRAS = window.APP_CONFIG || {};
  const URL_SB = (LOCAL.SUPABASE_URL || COMPRAS.SUPABASE_URL || '').trim();
  const KEY_SB = (LOCAL.SUPABASE_ANON_KEY || COMPRAS.SUPABASE_ANON_KEY || '').trim();
  const configurado = /^https:\/\//.test(URL_SB) && KEY_SB.length > 20 && !/SEU-PROJETO|COLE_AQUI/.test(URL_SB + KEY_SB);
  const DES = window.ALMOX_DESENHOS;
  const CATEGORIAS = DES.categorias;

  // ---------- Utilidades ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const h = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoje = () => new Date().toLocaleDateString('sv-SE');
  const dataBR = (d) => { if (!d) return '—'; const [a, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${a}`; };
  const num = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const lerNum = (s) => { s = String(s || '').trim().replace(/\s/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = parseFloat(s); return Number.isFinite(n) ? n : NaN; };
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const casa = (texto, q) => { const n = semAcento(texto); return !q || q.split(/\s+/).every((t) => n.includes(t)); };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const P = {
    in: 'M12 19V5M5 12l7-7 7 7', out: 'M12 5v14M5 12l7 7 7-7', box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4', x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14',
    chev: 'M9 6l6 6-6 6', back: 'M15 6l-6 6 6 6',
    camera: 'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    image: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  };
  const ic = (n, s) => `<svg width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

  function toast(msg, tipo, tempo) {
    let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div'); t.className = 'toast ' + (tipo || ''); t.textContent = msg; box.appendChild(t);
    setTimeout(() => t.remove(), tempo || 4500);
  }
  function dialogo(html) {
    const d = document.createElement('dialog'); d.innerHTML = html; document.body.appendChild(d);
    d.addEventListener('close', () => setTimeout(() => d.remove(), 50));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.showModal(); return d;
  }
  function msgErro(e) {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (!navigator.onLine || /failed to fetch|network|load failed/i.test(m)) return 'Sem conexão com a internet. Tente de novo quando tiver sinal.';
    if (/does not exist|could not find the function|schema cache/i.test(m)) return 'O banco está desatualizado. Rode o arquivo almoxarifado.sql no SQL Editor do Supabase.';
    if (/bucket not found/i.test(m)) return 'Falta rodar o almoxarifado.sql no Supabase (lugar das fotos).';
    return m;
  }

  // ---------- Estado ----------
  const S = { sb: null, itens: [], movs: {}, busca: '', filtro: 'com', canal: null, pronto: false };
  try { S.filtro = localStorage.getItem('almox.filtro2') || 'com'; } catch (_) {}
  const escolhido = { entrada: null, retirada: null };
  const app = () => $('#app');

  function cliente() {
    if (S.sb) return S.sb;
    if (!configurado || !window.supabase?.createClient) return null;
    S.sb = window.supabase.createClient(URL_SB, KEY_SB, { auth: { persistSession: false, autoRefreshToken: false } });
    return S.sb;
  }
  async function rpc(fn, args) { const { data, error } = await S.sb.rpc(fn, args || {}); if (error) throw error; return data; }

  // ---------- Organização: produto (grupo) com seus tamanhos/tipos ----------
  const LETRAS = { PP: 0, P: 1, M: 2, G: 3, GG: 4, XG: 5, EXG: 6, XGG: 6, EG: 5 };
  function ordemVar(a, b) {
    const rank = (v) => {
      if (!v) return [0, 0, ''];
      if (/^sem /i.test(v)) return [9, 0, v];
      const n = v.match(/(\d+)/); const l = v.trim().toUpperCase();
      if (l in LETRAS) return [1, LETRAS[l], ''];
      if (/^N°/i.test(v) && n) return [2, +n[1], ''];
      return [3, 0, semAcento(v)];
    };
    const x = rank(a.variacao), y = rank(b.variacao);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  }
  const rotulo = (it) => it.variacao || 'Único';
  function palavraVar(g) { return ['Calçados', 'Uniformes'].includes(g.categoria) && g.itens.some((i) => /^(N°\s*\d|(PP|P|M|G|GG|XG|EXG)$)/i.test((i.variacao || '').trim())) ? ['tamanho', 'tamanhos'] : ['tipo', 'tipos']; }
  function montarGrupos() {
    const m = new Map();
    for (const it of S.itens) {
      const nomeG = it.grupo || it.nome; const k = nomeG.toLowerCase();
      if (!m.has(k)) m.set(k, { grupo: nomeG, categoria: it.categoria || 'Outros', icone: it.icone || 'caixa', foto_url: null, itens: [] });
      const g = m.get(k); g.itens.push(it); if (!g.foto_url && it.foto_url) g.foto_url = it.foto_url;
    }
    const lista = [...m.values()];
    for (const g of lista) {
      g.itens.sort(ordemVar);
      g.total = g.itens.reduce((s, i) => s + i.saldo, 0);
      g.emFalta = g.itens.filter((i) => i.saldo <= 0).length;
      g.ultima = g.itens.map((i) => i.ultima_movimentacao).filter(Boolean).sort().pop() || null;
      g.busca = semAcento([g.grupo, g.categoria, ...g.itens.map((i) => i.variacao || '')].join(' '));
    }
    return lista.sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));
  }
  let GRUPOS = [];
  const grupoDe = (nome) => GRUPOS.find((g) => g.grupo.toLowerCase() === String(nome || '').toLowerCase());
  const itemDe = (id) => S.itens.find((i) => i.id === id);

  function imagem(g, cls) {
    const des = `<span class="ilus ${cls || ''}" aria-hidden="true">${DES.svg(g.icone, g.categoria)}</span>`;
    if (!g.foto_url) return des;
    return `<img class="foto ${cls || ''}" src="${h(g.foto_url)}" alt="Foto de ${h(g.grupo)}" loading="lazy" onerror="this.outerHTML=this.dataset.d" data-d="${h(des)}">`;
  }

  // ---------- Dados ----------
  async function carregar() {
    const { data, error } = await S.sb.from('vw_almox_estoque').select('*').eq('ativo', true);
    if (error) throw error;
    S.itens = data.map((p) => ({ ...p, saldo: Number(p.saldo) }));
    GRUPOS = montarGrupos(); S.movs = {};
    try { localStorage.setItem('almox.cache2', JSON.stringify({ itens: S.itens, em: new Date().toISOString() })); } catch (_) {}
  }
  function doCache() {
    try { const c = JSON.parse(localStorage.getItem('almox.cache2') || 'null'); if (c) { S.itens = c.itens; GRUPOS = montarGrupos(); return c.em; } } catch (_) {}
    return null;
  }
  let timer = null;
  function recarregarLogo() { clearTimeout(timer); timer = setTimeout(async () => { try { await carregar(); render(); } catch (_) {} }, 600); }
  function tempoReal() {
    if (S.canal || !S.sb) return;
    S.canal = S.sb.channel('almox')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'almox_movimentos' }, recarregarLogo)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'almox_itens' }, recarregarLogo)
      .subscribe();
  }
  async function historico(id) {
    if (S.movs[id]) return S.movs[id];
    const { data, error } = await S.sb.from('almox_movimentos').select('*').eq('item_id', id).order('data', { ascending: false }).order('criado_em', { ascending: false }).limit(50);
    if (error) throw error;
    return (S.movs[id] = data);
  }
  function atualizarLocal(id, saldo, data) {
    const it = itemDe(id); if (it) { it.saldo = Number(saldo); if (data) it.ultima_movimentacao = data; }
    delete S.movs[id]; GRUPOS = montarGrupos();
  }

  // ---------- Fotos ----------
  async function abrirImg(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
    const url = URL.createObjectURL(file);
    return new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error('Não foi possível abrir esta foto. Tente outra ou use "Tirar foto".')); i.src = url; });
  }
  async function reduzirFoto(file) {
    const img = await abrirImg(file);
    const w = img.width || img.naturalWidth, hh = img.height || img.naturalHeight, k = Math.min(1, 900 / Math.max(w, hh));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok, falha) => c.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível ler a foto.'))), 'image/jpeg', 0.84));
  }
  async function enviarFoto(blob, nome) {
    const caminho = `${Date.now()}-${semAcento(nome).replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.jpg`;
    const up = await S.sb.storage.from('almox').upload(caminho, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw up.error;
    return S.sb.storage.from('almox').getPublicUrl(caminho).data.publicUrl;
  }
  const botoesFoto = (attr) => `<div class="photo-row">
      <label class="btn btn-ghost btn-sm">${ic('camera', 18)} Tirar foto<input type="file" accept="image/*" capture="environment" class="sr" ${attr}></label>
      <label class="btn btn-ghost btn-sm">${ic('image', 18)} Galeria<input type="file" accept="image/*" class="sr" ${attr}></label></div>`;

  // =========================================================
  //   Estrutura
  // =========================================================
  const ABAS = [{ id: 'entrada', nome: 'Entrada', icone: 'in' }, { id: 'estoque', nome: 'Estoque', icone: 'box' }, { id: 'retirada', nome: 'Retirada', icone: 'out' }];
  function shell() {
    app().innerHTML = `
      <header class="topbar"><div class="brand"><span class="tag">Almoxarifado</span><span class="muted small">Estoque</span></div>
        <div class="spacer"></div><span class="net" id="net" hidden>Sem internet</span></header>
      <nav class="tabs" aria-label="Seções">${ABAS.map((a) => `<button data-tab="${a.id}">${ic(a.icone)}<span>${a.nome}</span></button>`).join('')}</nav>
      <main class="view" id="view" tabindex="-1"></main>`;
    $$('[data-tab]').forEach((b) => (b.onclick = () => { location.hash = '/' + b.dataset.tab; }));
    rede();
  }
  function rede() { const n = $('#net'); if (n) n.hidden = navigator.onLine; }
  window.addEventListener('online', () => { rede(); if (S.pronto) recarregarLogo(); });
  window.addEventListener('offline', rede);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.pronto && navigator.onLine) recarregarLogo(); });
  function abaAtual() { const t = location.hash.replace(/^#\/?/, ''); return ABAS.some((a) => a.id === t) ? t : 'estoque'; }
  window.addEventListener('hashchange', () => render(true));

  function render(trocou) {
    if (!S.pronto || !$('#view')) return;
    const tab = abaAtual(); const view = $('#view');
    if (!trocou && view.dataset.tab === tab && tab !== 'estoque' && $('form[data-sujo="1"]', view)) return;
    if (!trocou && tab === 'estoque' && view.dataset.tab === tab) { listar(); return; }
    const mudou = view.dataset.tab !== tab; view.dataset.tab = tab;
    $$('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    ({ entrada: vEntrada, estoque: vEstoque, retirada: vRetirada })[tab](view);
    if (mudou) { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
  }

  // =========================================================
  //   Estoque
  // =========================================================
  function vEstoque(view) {
    view.innerHTML = `
      <div class="page-head"><div><h1>Estoque</h1><p>Produtos do almoxarifado por categoria. Toque no produto para ver os tamanhos, as quantidades e a movimentação.</p></div>
        <button class="btn" id="novo">${ic('plus', 18)} Item novo</button></div>
      <div class="tools"><div class="search">${ic('search', 20)}<input type="search" class="input" id="busca" placeholder="Buscar produto (ex.: bota, luva, camiseta G)" value="${h(S.busca)}" aria-label="Buscar produto"></div></div>
      <div class="filtros" role="group" aria-label="Filtro" id="filtros"></div>
      <div id="lista"></div>`;
    $('#busca').oninput = (e) => { S.busca = e.target.value; listar(); };
    $('#novo').onclick = () => itemNovo({}, () => render(true));
    listar();
  }
  function listar() {
    const q = semAcento(S.busca).trim();
    const achados = GRUPOS.filter((g) => !q || q.split(/\s+/).every((t) => g.busca.includes(t)));
    const filtros = { com: (g) => g.total > 0, falta: (g) => g.emFalta > 0, todos: () => true };
    const nomes = { com: 'Com estoque', falta: 'Em falta', todos: 'Todos' };
    $('#filtros').innerHTML = Object.keys(nomes).map((k) => `<button class="chip" data-f="${k}" aria-pressed="${S.filtro === k}">${nomes[k]}<span class="n">${achados.filter(filtros[k]).length}</span></button>`).join('');
    $$('#filtros [data-f]').forEach((b) => (b.onclick = () => { S.filtro = b.dataset.f; try { localStorage.setItem('almox.filtro2', S.filtro); } catch (_) {} listar(); }));
    const lista = achados.filter(filtros[S.filtro] || filtros.com);
    const cats = [...CATEGORIAS, ...new Set(lista.map((g) => g.categoria).filter((c) => !CATEGORIAS.includes(c)))];
    $('#lista').innerHTML = lista.length ? cats.map((c) => {
      const gs = lista.filter((g) => g.categoria === c); if (!gs.length) return '';
      return `<section class="cat"><h2 class="cat-tit"><span class="cat-cor" style="background:${DES.cor(c)}"></span>${h(c)}<span class="muted small">${gs.length}</span></h2>
        <div class="cards">${gs.map(cartao).join('')}</div></section>`;
    }).join('') : `<div class="empty"><strong>${q ? 'Nenhum produto com esse nome' : S.filtro === 'falta' ? 'Nada em falta' : 'Nenhum produto com estoque'}</strong>${q ? 'Confira como foi escrito ou escolha "Todos".' : ''}</div>`;
    $$('#lista .card').forEach((b) => (b.onclick = () => abrirGrupo(b.dataset.g)));
  }
  function cartao(g) {
    const [um, varios] = palavraVar(g);
    const sub = g.itens.length > 1
      ? `${g.itens.length} ${varios}${g.emFalta ? ` · <span class="falta">${g.emFalta} em falta</span>` : ''}`
      : (g.ultima ? 'Última: ' + dataBR(g.ultima) : 'Sem movimentação');
    return `<button class="card" data-g="${h(g.grupo)}">${imagem(g, 'img')}
      <span class="body"><span class="nome">${h(g.grupo)}</span><span class="qtd ${g.total <= 0 ? 'zero' : ''}">${g.total <= 0 ? 'Zerado' : num(g.total)}</span>
      <span class="quando">${sub}</span></span></button>`;
  }

  // ---------- Produto: tamanhos/tipos e movimentação ----------
  function abrirGrupo(nome, itemId) {
    const g = grupoDe(nome); if (!g) return;
    const d = dialogo(`<div class="dlg" id="gdlg"></div>`);
    const corpo = $('#gdlg', d);
    const [um, varios] = palavraVar(g);
    function topo() {
      return `<div class="dlg-head"><h2>${h(g.grupo)}</h2><button class="icon-btn" data-x aria-label="Fechar">${ic('x')}</button></div>
        <div class="prod-top"><div id="g-img">${imagem(g, 'img')}</div>
          <div><p class="muted small">${h(g.categoria)}${g.itens.length > 1 ? ` · ${g.itens.length} ${varios}` : ''}</p><p class="qtd">${num(g.total)}</p><p class="muted small">no total</p>
          ${botoesFoto('data-foto')}</div></div>`;
    }
    function ligarTopo() {
      $('[data-x]', corpo).onclick = () => d.close();
      $$('[data-foto]', corpo).forEach((inp) => (inp.onchange = async () => {
        const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
        try {
          toast('Salvando foto…');
          const blob = await reduzirFoto(f);
          $('#g-img', corpo).innerHTML = `<img class="foto img" src="${URL.createObjectURL(blob)}" alt="">`;
          const url = await enviarFoto(blob, g.grupo);
          await rpc('almox_trocar_foto', { p_grupo: g.grupo, p_foto_url: url });
          S.itens.filter((i) => (i.grupo || i.nome).toLowerCase() === g.grupo.toLowerCase()).forEach((i) => (i.foto_url = url));
          GRUPOS = montarGrupos(); g.foto_url = url; toast('Foto atualizada.'); render();
        } catch (ex) { toast('A foto não foi salva: ' + msgErro(ex), 'erro', 9000); }
      }));
    }
    function telaVariacoes() {
      corpo.innerHTML = topo() + `
        <h3>${varios[0].toUpperCase() + varios.slice(1)}</h3>
        <div class="vars">${g.itens.map((it) => `<button class="var" data-id="${it.id}"><span class="v-nome">${h(rotulo(it))}</span><span class="v-qtd ${it.saldo <= 0 ? 'zero' : ''}">${it.saldo <= 0 ? 'Zerado' : num(it.saldo)}</span>${ic('chev', 18)}</button>`).join('')}</div>
        <button class="btn btn-ghost" id="add-var">${ic('plus', 18)} Adicionar ${um} novo</button>`;
      ligarTopo();
      $$('.var', corpo).forEach((b) => (b.onclick = () => telaItem(+b.dataset.id, true)));
      $('#add-var', corpo).onclick = () => { d.close(); itemNovo({ grupo: g.grupo }, () => render(true)); };
    }
    async function telaItem(id, comVolta) {
      const it = itemDe(id);
      corpo.innerHTML = (comVolta ? `<div class="dlg-head"><button class="btn btn-ghost btn-sm" id="voltar">${ic('back', 18)} ${h(g.grupo)}</button><button class="icon-btn" data-x aria-label="Fechar">${ic('x')}</button></div>
          <div><p class="muted small">${h(g.grupo)}</p><h2>${h(rotulo(it))}</h2></div>` : topo()) + `
        <div><p class="muted small">Em estoque</p><p class="qtd-big ${it.saldo <= 0 ? 'zero' : ''}">${num(it.saldo)}</p></div>
        <div class="row"><button class="btn btn-sm" data-ir="entrada">${ic('in', 18)} Dar entrada</button>${it.saldo > 0 ? `<button class="btn btn-out btn-sm" data-ir="retirada">${ic('out', 18)} Retirar</button>` : ''}
          ${!comVolta ? `<button class="btn btn-ghost btn-sm" id="add-var">${ic('plus', 18)} Adicionar ${um}</button>` : ''}</div>
        <h3>Movimentações</h3><ul class="mov" id="p-mov"><li class="muted">Carregando…</li></ul>`;
      if (comVolta) { $('[data-x]', corpo).onclick = () => d.close(); $('#voltar', corpo).onclick = telaVariacoes; } else ligarTopo();
      const av = $('#add-var', corpo); if (av) av.onclick = () => { d.close(); itemNovo({ grupo: g.grupo }, () => render(true)); };
      $$('[data-ir]', corpo).forEach((b) => (b.onclick = () => { d.close(); escolhido[b.dataset.ir] = it.id; location.hash = '/' + b.dataset.ir; render(true); }));
      try {
        const movs = await historico(it.id);
        $('#p-mov', corpo).innerHTML = movs.length ? movs.map((m) => {
          const ret = m.tipo === 'retirada';
          return `<li><span>${dataBR(m.data)} · ${ret ? 'Retirada' : m.tipo === 'inicial' ? 'Saldo inicial' : 'Entrada'}</span><span class="q ${ret ? 'out' : 'in'}">${ret ? '−' : '+'}${num(m.quantidade)}</span>${m.observacao && m.tipo !== 'inicial' ? `<small>${h(m.observacao)}</small>` : ''}</li>`;
        }).join('') : '<li class="muted">Nenhuma movimentação ainda.</li>';
      } catch (ex) { const el = $('#p-mov', corpo); if (el) el.innerHTML = `<li class="muted">${h(msgErro(ex))}</li>`; }
    }
    if (itemId) telaItem(itemId, g.itens.length > 1);
    else if (g.itens.length > 1) telaVariacoes();
    else telaItem(g.itens[0].id, false);
  }

  // =========================================================
  //   Item novo (foto, nome, tamanho/tipo e quantidade)
  // =========================================================
  function itemNovo(pre, aoCriar) {
    let foto = null;
    const d = dialogo(`<form class="dlg" id="f-novo" novalidate>
      <div class="dlg-head"><h2>${pre.grupo ? 'Novo tamanho ou tipo' : 'Item novo'}</h2><button type="button" class="icon-btn" data-x aria-label="Fechar">${ic('x')}</button></div>
      <div class="field"><span class="label">Foto</span><img class="foto-prev" id="n-img" alt="" hidden>${botoesFoto('data-nf')}
        <span class="hint" id="n-foto-hint">${pre.grupo ? 'Opcional. Se colocar, vale para o produto todo.' : 'Opcional. Sem foto, o produto aparece com um desenho.'}</span></div>
      <div class="field"><label for="n-grupo">Nome do produto</label><input id="n-grupo" class="input" list="n-grupos" value="${h(pre.grupo || '')}" placeholder="Ex.: Bota florestal" autocomplete="off">
        <datalist id="n-grupos">${GRUPOS.map((g) => `<option value="${h(g.grupo)}"></option>`).join('')}</datalist>
        <span class="hint" id="n-grupo-hint"></span></div>
      <div class="field"><label for="n-var">Tamanho ou tipo <span class="muted">(opcional)</span></label><input id="n-var" class="input" placeholder="Ex.: N° 40, G, Azul"></div>
      <div class="grid-2 stack-sm">
        <div class="field"><label for="n-cat">Categoria</label><select id="n-cat" class="input">${CATEGORIAS.map((c) => `<option>${h(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="n-qtd">Quantidade</label><input id="n-qtd" class="input qtd" inputmode="decimal" placeholder="0"></div>
      </div>
      <p class="form-error" id="n-err" role="alert"></p>
      <div class="dlg-foot"><button type="button" class="btn btn-ghost" data-x>Cancelar</button><button class="btn" id="n-btn">Cadastrar</button></div>
    </form>`);
    $$('[data-x]', d).forEach((b) => (b.onclick = () => d.close()));
    const verGrupo = () => {
      const g = grupoDe($('#n-grupo', d).value.trim());
      const cat = $('#n-cat', d);
      if (g) { cat.value = g.categoria; cat.disabled = true; $('#n-grupo-hint', d).textContent = `Produto que já existe (${g.itens.length} ${palavraVar(g)[g.itens.length > 1 ? 1 : 0]}): o item novo entra junto dele.`; }
      else { cat.disabled = false; $('#n-grupo-hint', d).textContent = ''; }
    };
    $('#n-grupo', d).oninput = verGrupo; verGrupo();
    (pre.grupo ? $('#n-var', d) : $('#n-grupo', d)).focus();
    $$('[data-nf]', d).forEach((inp) => (inp.onchange = async () => {
      const f = inp.files && inp.files[0]; inp.value = ''; if (!f) return;
      try { foto = await reduzirFoto(f); const im = $('#n-img', d); im.src = URL.createObjectURL(foto); im.hidden = false; }
      catch (ex) { $('#n-err', d).textContent = ex.message; }
    }));
    $('#f-novo', d).onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#n-err', d); err.textContent = '';
      const grupo = $('#n-grupo', d).value.trim().replace(/\s+/g, ' ');
      const variacao = $('#n-var', d).value.trim().replace(/\s+/g, ' ');
      const qtdTxt = $('#n-qtd', d).value.trim(); const qtd = qtdTxt ? lerNum(qtdTxt) : 0;
      if (grupo.length < 2) { $('#n-grupo', d).focus(); return (err.textContent = 'Informe o nome do produto.'); }
      if (!Number.isFinite(qtd) || qtd < 0) { $('#n-qtd', d).focus(); return (err.textContent = 'Informe a quantidade (zero ou mais).'); }
      const nomeFinal = (grupo + (variacao ? ' - ' + variacao : '')).toLowerCase();
      const existe = S.itens.find((i) => i.nome.toLowerCase() === nomeFinal);
      if (existe) return (err.textContent = `"${existe.nome}" já está cadastrado. Use a Entrada para somar quantidade.`);
      const g = grupoDe(grupo);
      if (g && !variacao && g.itens.length) return (err.textContent = `${g.grupo} já existe. Informe o tamanho ou tipo novo.`);
      const bt = $('#n-btn', d); bt.disabled = true; bt.textContent = 'Salvando…';
      try {
        const url = foto ? await enviarFoto(foto, grupo) : null;
        const novo = await rpc('almox_novo_item', { p_id: uuid(), p_grupo: g ? g.grupo : grupo, p_variacao: variacao || null, p_categoria: $('#n-cat', d).value, p_quantidade: qtd, p_foto_url: url, p_data: hoje() });
        await carregar();
        d.close(); toast(`${novo.nome} cadastrado${qtd > 0 ? ` com ${num(qtd)}` : ''}.`, 'in', 6000);
        if (aoCriar) aoCriar(novo.id);
      } catch (ex) { err.textContent = msgErro(ex); bt.disabled = false; bt.textContent = 'Cadastrar'; }
    };
  }

  // =========================================================
  //   Escolha do produto em 2 passos (produto > tamanho/tipo)
  // =========================================================
  function escolherProduto(modo, aoEscolher) {
    const fonte = modo === 'retirada' ? GRUPOS.filter((g) => g.total > 0) : GRUPOS;
    const d = dialogo(`<div class="dlg" id="esc"></div>`); const corpo = $('#esc', d);
    function passo1() {
      corpo.innerHTML = `<div class="dlg-head"><h2>${modo === 'retirada' ? 'Produto a retirar' : 'Produto da entrada'}</h2><button class="icon-btn" data-x aria-label="Fechar">${ic('x')}</button></div>
        <div class="search">${ic('search', 20)}<input type="search" class="input" id="e-busca" placeholder="Buscar produto" aria-label="Buscar produto"></div>
        ${modo === 'entrada' ? `<button class="btn btn-ghost" id="e-novo">${ic('plus', 18)} Item novo</button>` : ''}
        <div class="lista-escolha" id="e-lista">${fonte.map((g) => `<button class="pick" data-g="${h(g.grupo)}" data-b="${h(g.busca)}">${imagem(g)}<span class="txt"><b>${h(g.grupo)}</b><small>${h(g.categoria)} · ${g.total > 0 ? num(g.total) + ' em estoque' : 'Zerado'}${g.itens.length > 1 ? ` · ${g.itens.length} ${palavraVar(g)[1]}` : ''}</small></span><span class="chev">${ic('chev', 18)}</span></button>`).join('') || '<p class="muted">Nenhum produto com estoque.</p>'}</div>
        <p class="muted small" id="e-nada" hidden>Não encontrou? ${modo === 'entrada' ? 'Cadastre no botão "Item novo".' : 'Ele pode estar zerado: dê entrada primeiro.'}</p>`;
      $('[data-x]', corpo).onclick = () => d.close();
      $('#e-busca', corpo).oninput = (e) => {
        const q = semAcento(e.target.value).trim(); let vis = 0;
        $$('#e-lista .pick', corpo).forEach((b) => { const ok = !q || q.split(/\s+/).every((t) => b.dataset.b.includes(t)); b.hidden = !ok; if (ok) vis++; });
        $('#e-nada', corpo).hidden = vis > 0;
      };
      $$('#e-lista .pick', corpo).forEach((b) => (b.onclick = () => passo2(grupoDe(b.dataset.g))));
      const nv = $('#e-novo', corpo); if (nv) nv.onclick = () => { const nome = $('#e-busca', corpo).value.trim(); d.close(); itemNovo({ grupo: grupoDe(nome) ? nome : '' }, aoEscolher); };
      setTimeout(() => $('#e-busca', corpo).focus(), 50);
    }
    function passo2(g) {
      const opcoes = modo === 'retirada' ? g.itens.filter((i) => i.saldo > 0) : g.itens;
      if (opcoes.length === 1 && g.itens.length === 1) { d.close(); return aoEscolher(opcoes[0].id); }
      const [um, varios] = palavraVar(g);
      corpo.innerHTML = `<div class="dlg-head"><button class="btn btn-ghost btn-sm" id="e-voltar">${ic('back', 18)} Produtos</button><button class="icon-btn" data-x aria-label="Fechar">${ic('x')}</button></div>
        <div class="row" style="flex-wrap:nowrap">${imagem(g, 'mini')}<div><h2>${h(g.grupo)}</h2><p class="muted small">Escolha o ${um}</p></div></div>
        <div class="vars">${opcoes.map((it) => `<button class="var" data-id="${it.id}"><span class="v-nome">${h(rotulo(it))}</span><span class="v-qtd ${it.saldo <= 0 ? 'zero' : ''}">${it.saldo <= 0 ? 'Zerado' : num(it.saldo)}</span>${ic('chev', 18)}</button>`).join('')}</div>
        ${modo === 'entrada' ? `<button class="btn btn-ghost" id="e-novavar">${ic('plus', 18)} Adicionar ${um} novo</button>` : ''}`;
      $('[data-x]', corpo).onclick = () => d.close();
      $('#e-voltar', corpo).onclick = passo1;
      $$('.var', corpo).forEach((b) => (b.onclick = () => { d.close(); aoEscolher(+b.dataset.id); }));
      const nv = $('#e-novavar', corpo); if (nv) nv.onclick = () => { d.close(); itemNovo({ grupo: g.grupo }, aoEscolher); };
    }
    passo1();
  }
  function campoProduto(modo) {
    const it = itemDe(escolhido[modo]); const g = it && grupoDe(it.grupo || it.nome);
    return `<div class="field"><span class="label">Produto</span>
      <button type="button" class="pick" id="${modo}-prod">${g ? imagem(g) : `<span class="ilus" aria-hidden="true">${DES.svg('caixa', 'Outros')}</span>`}
        <span class="txt">${it ? `<b>${h(g.grupo)}${it.variacao ? ' · ' + h(it.variacao) : ''}</b><small>${it.saldo > 0 ? num(it.saldo) + ' em estoque' : 'Zerado'}</small>` : `<b>Escolher produto</b><small>${modo === 'entrada' ? 'ou cadastrar um item novo' : 'só aparecem os que têm estoque'}</small>`}</span>
        <span class="chev">${ic('chev', 20)}</span></button></div>`;
  }
  function trocarProduto(modo) {
    const form = $(modo === 'entrada' ? '#f-ent' : '#f-ret'); if (!form) return render(true);
    form.dataset.sujo = '1';
    $(`#${modo}-prod`).closest('.field').outerHTML = campoProduto(modo);
    $(`#${modo}-prod`).onclick = () => escolherProduto(modo, (id) => { escolhido[modo] = id; trocarProduto(modo); });
    if (modo === 'retirada') atualizarDisponivel();
  }

  // =========================================================
  //   Entrada
  // =========================================================
  function vEntrada(view) {
    if (escolhido.entrada && !itemDe(escolhido.entrada)) escolhido.entrada = null;
    view.innerHTML = `
      <div class="page-head"><div><h1>Entrada</h1><p>Registre o que chegou no almoxarifado. A quantidade soma no estoque.</p></div></div>
      <form class="panel in" id="f-ent" novalidate>
        <div class="grid-2 stack-sm">
          <div class="field"><label for="ent-data">Data</label><input id="ent-data" type="date" class="input" value="${hoje()}" max="${hoje()}"></div>
          <div class="field"><label for="ent-qtd">Quantidade</label><input id="ent-qtd" class="input qtd" inputmode="decimal" placeholder="0"></div>
        </div>
        ${campoProduto('entrada')}
        <p class="form-error" id="ent-err" role="alert"></p>
        <div class="row end"><button class="btn" id="ent-btn">${ic('in', 18)} Registrar entrada</button></div>
      </form>`;
    const form = $('#f-ent');
    form.oninput = () => { form.dataset.sujo = '1'; $('#ent-err').textContent = ''; };
    $('#entrada-prod').onclick = () => escolherProduto('entrada', (id) => { escolhido.entrada = id; trocarProduto('entrada'); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#ent-err'); err.textContent = '';
      const dados = { data: $('#ent-data').value, qtd: lerNum($('#ent-qtd').value), id: escolhido.entrada };
      if (!dados.data) return (err.textContent = 'Informe a data.');
      if (dados.data > hoje()) return (err.textContent = 'A data não pode ser no futuro.');
      if (!dados.id) return (err.textContent = 'Escolha o produto.');
      if (!(dados.qtd > 0)) { $('#ent-qtd').focus(); return (err.textContent = 'Informe uma quantidade maior que zero.'); }
      const bt = $('#ent-btn'); bt.disabled = true;
      try {
        const saldo = await rpc('almox_registrar_entrada', { p_id: uuid(), p_data: dados.data, p_item: dados.id, p_quantidade: dados.qtd });
        const it = itemDe(dados.id); atualizarLocal(dados.id, saldo, dados.data);
        toast(`Entrada registrada: +${num(dados.qtd)} ${it ? it.nome : ''}. Agora há ${num(saldo)}.`, 'in', 6000);
        escolhido.entrada = null; delete form.dataset.sujo; render(true);
      } catch (ex) { err.textContent = msgErro(ex); bt.disabled = false; }
    };
  }

  // =========================================================
  //   Retirada
  // =========================================================
  function vRetirada(view) {
    if (escolhido.retirada && !(itemDe(escolhido.retirada) && itemDe(escolhido.retirada).saldo > 0)) escolhido.retirada = null;
    view.innerHTML = `
      <div class="page-head"><div><h1>Retirada</h1><p>Registre o que saiu do almoxarifado. A quantidade desconta do estoque.</p></div></div>
      <form class="panel out" id="f-ret" novalidate>
        <div class="grid-2 stack-sm">
          <div class="field"><label for="ret-data">Data da retirada</label><input id="ret-data" type="date" class="input" value="${hoje()}" max="${hoje()}"></div>
          <div class="field"><label for="ret-qtd">Quantidade</label><input id="ret-qtd" class="input qtd" inputmode="decimal" placeholder="0"></div>
        </div>
        ${campoProduto('retirada')}
        <p class="disp" id="ret-disp" hidden></p>
        <div class="field"><label for="ret-obs">Observação</label><textarea id="ret-obs" class="input" placeholder="Ex.: entregue para a equipe BU, colaborador João"></textarea></div>
        <p class="form-error" id="ret-err" role="alert"></p>
        <div class="row end"><button class="btn btn-out" id="ret-btn">${ic('out', 18)} Registrar retirada</button></div>
      </form>`;
    const form = $('#f-ret');
    form.oninput = () => { form.dataset.sujo = '1'; $('#ret-err').textContent = ''; atualizarDisponivel(); };
    $('#retirada-prod').onclick = () => escolherProduto('retirada', (id) => { escolhido.retirada = id; trocarProduto('retirada'); });
    atualizarDisponivel();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $('#ret-err'); err.textContent = '';
      const it = itemDe(escolhido.retirada);
      const dados = { data: $('#ret-data').value, qtd: lerNum($('#ret-qtd').value), obs: $('#ret-obs').value.trim() };
      if (!dados.data) return (err.textContent = 'Informe a data da retirada.');
      if (dados.data > hoje()) return (err.textContent = 'A data não pode ser no futuro.');
      if (!it) return (err.textContent = 'Escolha o produto.');
      if (!(dados.qtd > 0)) { $('#ret-qtd').focus(); return (err.textContent = 'Informe uma quantidade maior que zero.'); }
      if (dados.qtd > it.saldo) { $('#ret-qtd').focus(); return (err.textContent = `Só há ${num(it.saldo)} de ${it.nome} em estoque.`); }
      const bt = $('#ret-btn'); bt.disabled = true;
      try {
        const saldo = await rpc('almox_registrar_retirada', { p_id: uuid(), p_data: dados.data, p_item: it.id, p_quantidade: dados.qtd, p_observacao: dados.obs || null });
        atualizarLocal(it.id, saldo, dados.data);
        toast(`Retirada registrada: −${num(dados.qtd)} ${it.nome}. Restam ${num(saldo)}.`, 'out', 6000);
        escolhido.retirada = null; delete form.dataset.sujo; render(true);
      } catch (ex) { err.textContent = msgErro(ex); bt.disabled = false; recarregarLogo(); }
    };
  }
  function atualizarDisponivel() {
    const el = $('#ret-disp'); if (!el) return;
    const it = itemDe(escolhido.retirada);
    if (!it) { el.hidden = true; return; }
    const q = lerNum($('#ret-qtd').value);
    const resta = it.saldo - (q > 0 ? q : 0);
    el.hidden = false; el.classList.toggle('zero', resta < 0);
    el.textContent = resta < 0 ? `Só há ${num(it.saldo)} em estoque.` : q > 0 ? `Disponível: ${num(it.saldo)} · depois da retirada: ${num(resta)}` : `Disponível: ${num(it.saldo)}`;
  }

  // =========================================================
  //   Início
  // =========================================================
  async function iniciar() {
    S.pronto = true;
    shell();
    try { await carregar(); }
    catch (ex) { const em = doCache(); toast(em ? 'Sem conexão. Mostrando o último estoque salvo neste aparelho.' : msgErro(ex), 'erro', 8000); }
    render(true);
    tempoReal();
  }
  function boot() {
    if (!cliente()) {
      if (doCache()) { S.pronto = true; shell(); render(true); toast('Sem conexão. Mostrando o último estoque salvo neste aparelho.', 'erro', 8000); return; }
      app().innerHTML = `<div class="auth"><div class="auth-box"><span class="tag big">Almoxarifado</span><div class="auth-card"><h2>Sem conexão com o banco</h2>
        <p>${navigator.onLine ? 'Não encontrei o endereço do banco. Confira o config.js do App de Compras ou preencha o config.js deste app.' : 'Conecte-se à internet e tente de novo.'}</p>
        <button class="btn" onclick="location.reload()">Tentar de novo</button></div></div></div>`;
      return;
    }
    iniciar();
  }
  boot();
})();
