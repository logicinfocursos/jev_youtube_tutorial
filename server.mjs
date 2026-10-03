import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const env = { ...process.env, ...await loadEnv(join(root, '.env')) };
const tickets = JSON.parse(await readFile(join(root, 'data', 'tickets.json'), 'utf8'));
const port = Number(env.PORT || 4180);

const prices = {
  jev: { input: rate('JEV_INPUT_USD_PER_MTOK', 0.042), output: rate('JEV_OUTPUT_USD_PER_MTOK', 0) },
  deepseek: { input: rate('DEEPSEEK_INPUT_USD_PER_MTOK', 0.28), output: rate('DEEPSEEK_OUTPUT_USD_PER_MTOK', 0.42) },
  haiku: { input: rate('HAIKU_INPUT_USD_PER_MTOK', 1), output: rate('HAIKU_OUTPUT_USD_PER_MTOK', 5) },
  luna: { input: rate('LUNA_INPUT_USD_PER_MTOK', 0.1), output: rate('LUNA_OUTPUT_USD_PER_MTOK', 0.5) }
};

const owners = {
  sales: { team: 'Comercial', name: 'Camila Rocha' },
  support: { team: 'Suporte técnico', name: 'Rafael Mendes' },
  billing: { team: 'Financeiro', name: 'Patrícia Lima' },
  security_legal: { team: 'Segurança & Jurídico', name: 'Bruno Alves' }
};
function rate(name, fallback) { return Number(env[name] ?? fallback); }
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function usd(usage, provider) {
  const p = prices[provider];
  return ((usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000);
}
function ticketState(ticket) {
  return { ticket_id: ticket.id, customer_segment: ticket.segment, subject: ticket.subject, message: ticket.message };
}
const departmentCriteria = {
  sales: 'Demonstração, proposta, preço, contrato, plano, expansão ou compra.',
  support: 'Uso do produto, bug, integração, incidente, autenticação, dados ou ajuda técnica.',
  billing: 'Cobrança, fatura, reembolso, pagamento, cancelamento financeiro ou nota fiscal.',
  security_legal: 'Segurança, privacidade, LGPD, DPA, auditoria, credenciais expostas ou solicitação jurídica.'
};
const urgencyCriteria = {
  critical: 'Interrupção ampla de produção, risco de segurança ativo ou dano relevante e imediato.',
  high: 'Impacto material em cliente, prazo comercial no mesmo dia ou risco claro de churn.',
  normal: 'Precisa de atendimento, mas há alternativa ou não há impacto imediato.',
  low: 'Dúvida, pedido de informação ou melhoria sem urgência operacional.'
};
function llmPrompt(ticket) {
  const isLead = ticket.segment === 'prospect';
  const signal = isLead
    ? 'Potencial de assinatura: número de 0 a 1, em que 1 significa forte intenção de contratar ou avançar na compra.'
    : 'Risco de cancelamento: número de 0 a 1, em que 1 significa forte sinal de cancelamento ou churn.';
  const schema = isLead
    ? '{"department":"sales|support|billing|security_legal","urgency":"critical|high|normal|low","subscriptionPotential":0.0}'
    : '{"department":"sales|support|billing|security_legal","urgency":"critical|high|normal|low","cancellationRisk":0.0}';
  return `Você é um roteador de tickets de um SaaS de IA. Classifique o ticket em exatamente um departamento e uma urgência, e estime o sinal comercial solicitado.\n\nDepartamentos: sales (proposta, demonstração, contrato, expansão), support (uso, bugs, integração, incidentes), billing (cobrança, reembolso, pagamento, cancelamento financeiro), security_legal (segurança, privacidade, LGPD, jurídico).\nUrgência: critical (produção parada, segurança ativa ou dano imediato), high (impacto material, prazo comercial hoje ou churn), normal (atendimento necessário sem impacto imediato), low (dúvida/melhoria).\n${signal}\nResponda SOMENTE JSON válido: ${schema}.`;
}

async function runJev(ticket) {
  if (!env.TYPESAFE_API_KEY) throw new Error('Defina TYPESAFE_API_KEY no arquivo .env.');
  const started = performance.now();
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: ticketState(ticket), questions: {
      department: { type: 'choice', instructions: 'Escolha o departamento responsável pelo primeiro atendimento.', criteria: departmentCriteria },
      urgency: { type: 'choice', instructions: 'Escolha a urgência operacional do ticket.', criteria: urgencyCriteria },
      ...(ticket.segment === 'prospect'
        ? { subscription_potential: { type: 'noul', instructions: 'Qual é a probabilidade de que este lead tenha intenção concreta de assinar ou avançar na compra?' } }
        : { cancellation_risk: { type: 'noul', instructions: 'Qual é a probabilidade de que este ticket sinalize risco de cancelamento ou churn?' } })
    }})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || body.message || `Jev HTTP ${response.status}`);
  const usage = { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
  return { ticketId: ticket.id, department: body.answers?.department?.choice, urgency: body.answers?.urgency?.choice,
    cancellationRisk: ticket.segment === 'subscriber' ? body.answers?.cancellation_risk?.noul : null,
    subscriptionPotential: ticket.segment === 'prospect' ? body.answers?.subscription_potential?.noul : null,
    confidence: Math.min(body.answers?.department?.confidence ?? 0, body.answers?.urgency?.confidence ?? 0),
    latencyMs: Math.round(performance.now() - started), usage, costUsd: usd(usage, 'jev') };
}

async function runDeepSeek(ticket) {
  if (!env.DEEPSEEK_API_KEY) throw new Error('Defina DEEPSEEK_API_KEY no arquivo .env.');
  const started = performance.now();
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: llmPrompt(ticket) }, { role: 'user', content: JSON.stringify(ticketState(ticket)) }
    ]})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `DeepSeek HTTP ${response.status}`);
  return formatLlm(ticket, body.choices?.[0]?.message?.content, body.usage, performance.now() - started, 'deepseek');
}

async function runHaiku(ticket) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Defina ANTHROPIC_API_KEY no arquivo .env.');
  const started = performance.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', ...(env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': env.ANTHROPIC_WORKSPACE_ID } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 100, system: llmPrompt(ticket),
      messages: [{ role: 'user', content: JSON.stringify(ticketState(ticket)) }] })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Anthropic HTTP ${response.status}`);
  return formatLlm(ticket, body.content?.[0]?.text, body.usage, performance.now() - started, 'haiku');
}

async function runLuna(ticket) {
  if (!env.OPENAI_API_KEY) throw new Error('Defina OPENAI_API_KEY no arquivo .env.');
  const started = performance.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-6-luna', reasoning_effort: 'none', response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: llmPrompt(ticket) }, { role: 'user', content: JSON.stringify(ticketState(ticket)) }
    ]})
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `OpenAI HTTP ${response.status}`);
  return formatLlm(ticket, body.choices?.[0]?.message?.content, body.usage, performance.now() - started, 'luna');
}

function formatLlm(ticket, content, rawUsage, latency, provider) {
  let decision;
  try { decision = JSON.parse(content); } catch { throw new Error(`Resposta não era JSON válido: ${String(content).slice(0, 120)}`); }
  const signalName = ticket.segment === 'prospect' ? 'subscriptionPotential' : 'cancellationRisk';
  if (!departmentCriteria[decision.department] || !urgencyCriteria[decision.urgency] || !Number.isFinite(decision[signalName]) || decision[signalName] < 0 || decision[signalName] > 1) throw new Error('Resposta JSON não respeitou o esquema solicitado.');
  const usage = { inputTokens: rawUsage?.prompt_tokens ?? rawUsage?.input_tokens ?? 0, outputTokens: rawUsage?.completion_tokens ?? rawUsage?.output_tokens ?? 0 };
  return { ticketId: ticket.id, department: decision.department, urgency: decision.urgency,
    cancellationRisk: ticket.segment === 'subscriber' ? decision.cancellationRisk : null,
    subscriptionPotential: ticket.segment === 'prospect' ? decision.subscriptionPotential : null, confidence: null,
    latencyMs: Math.round(latency), usage, costUsd: usd(usage, provider) };
}

async function withConcurrency(items, task, limit = 3) {
  const results = []; let cursor = 0;
  async function worker() { while (cursor < items.length) { const item = items[cursor++]; try { results.push({ ok: true, value: await task(item) }); } catch (error) { results.push({ ok: false, ticketId: item.id, error: error.message }); } } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.sort((a, b) => (a.value?.ticketId || a.ticketId).localeCompare(b.value?.ticketId || b.ticketId));
}

async function analyze(provider) {
  const runner = { jev: runJev, deepseek: runDeepSeek, haiku: runHaiku, luna: runLuna }[provider];
  if (!runner) throw new Error('Provedor inválido.');
  const started = performance.now();
  const results = await withConcurrency(tickets, runner);
  const successful = results.filter(x => x.ok).map(x => x.value);
  return { provider, totalLatencyMs: Math.round(performance.now() - started), completed: successful.length, failed: results.length - successful.length,
    inputTokens: successful.reduce((n, x) => n + x.usage.inputTokens, 0), outputTokens: successful.reduce((n, x) => n + x.usage.outputTokens, 0),
    costUsd: successful.reduce((n, x) => n + x.costUsd, 0), results };
}

function aggregate(provider, results, started) {
  const successful = results.filter(x => x.ok).map(x => x.value);
  return { provider, totalLatencyMs: Math.round(performance.now() - started), completed: successful.length, failed: results.length - successful.length,
    inputTokens: successful.reduce((n, x) => n + x.usage.inputTokens, 0), outputTokens: successful.reduce((n, x) => n + x.usage.outputTokens, 0),
    costUsd: successful.reduce((n, x) => n + x.costUsd, 0), results };
}
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
async function streamAnalysis(res, provider) {
  const runner = { jev: runJev, deepseek: runDeepSeek, haiku: runHaiku, luna: runLuna }[provider];
  if (!runner) throw new Error('Provedor inválido.');
  const started = performance.now(), results = [];
  sse(res, 'start', { provider, ticketCount: tickets.length });
  for (const ticket of tickets) {
    sse(res, 'reading', { ticketId: ticket.id });
    try { const value = await runner(ticket); results.push({ ok: true, value: { ...value, owner: owners[value.department] } }); }
    catch (error) { results.push({ ok: false, ticketId: ticket.id, error: error.message }); }
    sse(res, 'result', { result: results.at(-1), summary: aggregate(provider, results, started) });
  }
  sse(res, 'complete', aggregate(provider, results, started));
  res.end();
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/api/tickets') return json(res, 200, tickets);
  if (req.method === 'POST' && url.pathname === '/api/analyze') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    try { return json(res, 200, await analyze(JSON.parse(raw).provider)); } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/analyze/stream') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    try {
      const { provider } = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      await streamAnalysis(res, provider);
    } catch (error) { sse(res, 'error', { error: error.message }); res.end(); }
    return;
  }
  const clean = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([.][.][\\/])+/, '');
  try { const file = await readFile(join(root, 'public', clean)); res.writeHead(200, { 'content-type': mime[extname(clean)] || 'application/octet-stream' }); res.end(file); }
  catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, () => console.log(`Jev Ticket Lab: http://localhost:${port}`));

async function loadEnv(file) {
  try { const text = await readFile(file, 'utf8'); return Object.fromEntries(text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; })); }
  catch { return {}; }
}
