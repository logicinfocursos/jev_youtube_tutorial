const tbody = document.querySelector('#tickets');
const status = document.querySelector('#status');
const jevButton = document.querySelector('#analyzeJev');
const llmButton = document.querySelector('#analyzeLlm');
const provider = document.querySelector('#provider');
const summary = document.querySelector('#summary');
let tickets = [], runs = { jev: null, llm: null }, reading = { jev: null, llm: null };
const label = { sales: 'Vendas', support: 'Suporte', billing: 'Financeiro', security_legal: 'Segurança/Jurídico', critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa' };

fetch('/api/tickets').then(r => r.json()).then(data => { tickets = data; render(); }).catch(e => status.textContent = `Falha ao carregar tickets: ${e.message}`);
provider.addEventListener('change', () => { document.querySelector('#llmHeading').textContent = llmName(); render(); });
jevButton.addEventListener('click', () => run('jev'));
llmButton.addEventListener('click', () => run('llm'));

function llmName() { return provider.options[provider.selectedIndex].text; }
async function run(target) {
  const apiProvider = target === 'jev' ? 'jev' : provider.value;
  const button = target === 'jev' ? jevButton : llmButton;
  button.disabled = true;
  runs[target] = { provider: apiProvider, totalLatencyMs: 0, completed: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, results: [] };
  reading[target] = null;
  status.textContent = `${target === 'jev' ? 'Jev' : llmName()} iniciou a varredura sequencial dos ${tickets.length} tickets…`;
  render();
  try {
    const response = await fetch('/api/analyze/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: apiProvider }) });
    if (!response.ok || !response.body) throw new Error('Não foi possível iniciar a varredura. Verifique a chave do provedor.');
    await consumeSse(response.body, target);
  } catch (error) { status.textContent = `Falha na varredura: ${error.message}`; }
  finally { reading[target] = null; button.disabled = false; render(); }
}
async function consumeSse(stream, target) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = '';
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n'); buffer = chunks.pop();
    for (const chunk of chunks) {
      const event = chunk.match(/^event: (.+)$/m)?.[1]; const raw = chunk.match(/^data: (.+)$/m)?.[1];
      if (!event || !raw) continue; const data = JSON.parse(raw);
      if (event === 'reading') { reading[target] = data.ticketId; status.textContent = `${target === 'jev' ? 'Jev' : llmName()} está lendo ${data.ticketId}…`; }
      if (event === 'result' || event === 'complete') runs[target] = data.summary || data;
      if (event === 'complete') status.textContent = `${target === 'jev' ? 'Jev' : llmName()} concluiu ${data.completed}/${tickets.length} tickets em ${data.totalLatencyMs} ms.`;
      if (event === 'error') throw new Error(data.error);
      render();
    }
  }
}
function lookup(run, id) { return run?.results?.find(x => (x.value?.ticketId || x.ticketId) === id); }
function decision(run, id) {
  const item = lookup(run, id);
  if (!item) return '<span class="small">Aguardando…</span>';
  if (!item.ok) return `<span class="error">${escapeHtml(item.error)}</span>`;
  const x = item.value;
  const commercialSignal = x.subscriptionPotential !== null && x.subscriptionPotential !== undefined
    ? `Potencial de assinatura <b>${Math.round(x.subscriptionPotential * 100)}%</b>`
    : `Risco de cancelamento <b>${Math.round(x.cancellationRisk * 100)}%</b>`;
  return `<div class="decision"><span><b>${label[x.department] || x.department}</b> → ${x.owner ? escapeHtml(x.owner.name) : ''} <span class="tag ${['critical', 'high'].includes(x.urgency) ? 'urgent' : ''}">${label[x.urgency] || x.urgency}</span></span><span>${commercialSignal}</span>${x.confidence !== null ? `<span class="small">confiança ${(x.confidence * 100).toFixed(0)}%</span>` : ''}<span class="small">${x.latencyMs} ms · ${x.usage.inputTokens} in / ${x.usage.outputTokens} out</span></div>`;
}
function render() {
  document.querySelector('#llmHeading').textContent = llmName();
  tbody.innerHTML = tickets.map(t => `<tr class="${reading.jev === t.id ? 'reading-jev' : ''} ${reading.llm === t.id ? 'reading-llm' : ''}"><td>${t.id}<div class="small">${t.segment === 'prospect' ? 'Lead' : 'Assinante'}</div>${reading.jev === t.id ? '<div class="scanning jev-scan">Jev lendo</div>' : ''}${reading.llm === t.id ? '<div class="scanning llm-scan">LLM lendo</div>' : ''}</td><td><div class="subject">${escapeHtml(t.subject)}</div><div class="message">${escapeHtml(t.message)}</div></td><td>${decision(runs.jev, t.id)}</td><td>${decision(runs.llm, t.id)}</td></tr>`).join('');
  if (runs.jev || runs.llm) { summary.classList.remove('hidden'); summary.innerHTML = (runs.jev ? card('Jev', runs.jev, false) : emptyCard('Jev', false)) + (runs.llm ? card(llmName(), runs.llm, true) : emptyCard(llmName(), true)) + comparison(); }
  else summary.classList.add('hidden');
}
function card(name, run, llm) { const done = run.completed + run.failed, pct = Math.round(done / tickets.length * 100); return `<article class="metric ${llm ? 'llm' : ''}"><h2>${name}</h2><div class="progress"><i style="width:${pct}%"></i></div><span class="small">${done}/${tickets.length} tickets · média ${done ? Math.round(run.totalLatencyMs / done) : 0} ms/ticket</span><div class="numbers"><span>Lote<b>${run.totalLatencyMs} ms</b></span><span>Concluídos<b>${run.completed}/${tickets.length}</b></span><span>Tokens<b>${run.inputTokens.toLocaleString()} / ${run.outputTokens.toLocaleString()}</b></span><span>Custo estimado<b>US$ ${run.costUsd.toFixed(6)}</b></span></div></article>`; }
function comparison() {
  const j = runs.jev, l = runs.llm;
  if (!j || !l || j.completed + j.failed < tickets.length || l.completed + l.failed < tickets.length) return '<article class="compare small">A comparação aparece quando os dois métodos terminarem a varredura.</article>';
  const row = (name, a, b, fmt) => { const diff = b - a, pct = b ? Math.abs(diff) / b * 100 : 0; return `<tr><td>${name}</td><td>${fmt(a)}</td><td>${fmt(b)}</td><td>${diff >= 0 ? '−' : '+'}${fmt(Math.abs(diff))}</td><td><b class="${diff >= 0 ? 'win' : 'loss'}">Jev ${pct.toFixed(1)}% ${diff >= 0 ? 'menor' : 'maior'}</b></td></tr>`; };
  const tok = r => r.inputTokens + r.outputTokens;
  const same = k => tickets.filter(t => { const a = lookup(j, t.id), b = lookup(l, t.id); return a?.ok && b?.ok && a.value[k] === b.value[k]; }).length;
  return `<article class="compare"><h2>Jev vs ${llmName()}</h2><table class="cmp"><thead><tr><th></th><th>Jev</th><th>${llmName()}</th><th>Diferença</th><th>Comparação</th></tr></thead><tbody>${row('Tempo', j.totalLatencyMs, l.totalLatencyMs, v => (v / 1000).toFixed(2) + ' s')}${row('Custo', j.costUsd, l.costUsd, v => 'US$ ' + v.toFixed(6))}${row('Tokens', tok(j), tok(l), v => v.toLocaleString())}</tbody></table><p class="small">Concordância entre os métodos: responsável ${same('department')}/${tickets.length} · urgência ${same('urgency')}/${tickets.length}. Sem gabarito, divergência não indica qual está certo.</p></article>`;
}
function emptyCard(name, llm) { return `<article class="metric ${llm ? 'llm' : ''}"><h2>${name}</h2><span class="small">Ainda não executado. Use o botão correspondente para iniciar a varredura.</span></article>`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
