# Prompt para gerar o app Jev vs LLM Agent

Antes de colar o prompt no Claude Code, instale a skill da TypeSafe:

```
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

Depois cole o prompt abaixo:

> Use a skill TypeSafe (typesafe-ai) e leia a documentação atual em https://docs.typesafe.ai/llms.txt antes de escrever a integração com o Jev.
>
> Crie na pasta `apps/demo` um app local chamado **Jev vs LLM Agent**, em Node.js 18+ sem dependências externas (servidor `server.mjs` + HTML/CSS/JS estáticos em `public/`). O objetivo é ilustrar, com dados fictícios, a diferença entre um modelo de decisão System One (Jev) e um LLM gerativo ao classificar chamados de suporte de um SaaS de IA.
>
> **Dados:** crie `data/tickets.json` com 12 chamados fictícios em português, misturando leads (`segment: "prospect"`) e assinantes (`segment: "subscriber"`). Campos: `id`, `segment`, `subject`, `message`, `createdAt`.
>
> **O que classificar em cada chamado:**
> 1. Responsável: `sales`, `support`, `billing` ou `security_legal`, mapeado para um time e uma pessoa fictícios.
> 2. Urgência: `critical`, `high`, `normal` ou `low`.
> 3. Se for lead: probabilidade de fechamento (0 a 1).
> 4. Se for assinante: probabilidade de cancelamento (0 a 1).
>
> **Jev:** chame `POST https://api.typesafe.ai/v1/systemone` com `model: "jev-latest"`, o chamado como `state` e, no mesmo pedido, duas perguntas `choice` (`department`, `urgency`, com critérios descritivos) e uma pergunta `noul` (`subscription_potential` para leads ou `cancellation_risk` para assinantes). Leia `answers`, `confidence` e `usage.input_tokens/output_tokens`.
>
> **LLM agent:** um seletor na interface deve permitir escolher entre DeepSeek Chat (`deepseek-chat`), Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) e OpenAI GPT-6 Luna (`gpt-6-luna`, com `reasoning_effort: "none"`). O LLM recebe a instrução equivalente e deve responder somente JSON; valide o JSON e o esquema e registre falhas de parse como erro do chamado.
>
> **Interface:** dois botões independentes, "Analisar com Jev" e "Analisar com LLM". Processe os chamados **sequencialmente** (um por vez) via Server-Sent Events, destacando a linha do chamado que está sendo lido, com barra de progresso, para mostrar visualmente a velocidade de cada método. Em cada linha mostre responsável, urgência, o sinal comercial correto para o segmento, confiança quando existir, latência e tokens de entrada/saída.
>
> **Estatísticas:** para cada método, mostre tempo total, custo e tokens. Quando os dois terminarem, mostre uma tabela comparativa com a diferença absoluta e o percentual (por exemplo, "Jev 70% menor") para tempo, custo e tokens, além de quantos chamados tiveram o mesmo responsável e a mesma urgência nos dois métodos.
>
> **Segurança e honestidade:** leia `TYPESAFE_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY` e `OPENAI_API_KEY` de um `.env` no servidor; nunca exponha chaves no navegador. Calcule o custo com tarifas por milhão de tokens configuráveis no `.env` (`*_INPUT_USD_PER_MTOK`, `*_OUTPUT_USD_PER_MTOK`). Não simule respostas: se uma chave estiver ausente, retorne um erro explícito. Crie `.env.example`, `package.json` (`npm start`) e um README curto dizendo que o teste mede um cenário específico e que os dados são fictícios.

## Dica para o vídeo

Substitua as chaves por variáveis de ambiente e corte qualquer trecho do `.env` que mostre valores. Os preços são configurações do experimento; confira a página de preços de cada fornecedor antes de gravar números.
