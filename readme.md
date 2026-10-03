# Jev vs LLM Agent - app demonstração
([github repository](https://github.com/logicinfocursos/jev_youtube_tutorial.git))

App de demonstração que compara o **Jev** (modelo System One da TypeSafe) com um **LLM agent** na triagem de chamados de suporte. Ele serve apenas para ilustrar, em um exemplo prático, como implementar o Jev com o Claude Code. **Todos os dados são fictícios.**

<img src="/apps/demo/assets/app-screenshoot.png">

## O que o app faz

Para cada um dos 12 chamados de `data/tickets.json` (leads e assinantes de um SaaS de IA), o app define:

- o **responsável** (Comercial, Suporte técnico, Financeiro ou Segurança & Jurídico);
- a **urgência** (crítica, alta, normal ou baixa);
- para **leads**, a chance de fechamento; para **assinantes**, a chance de cancelamento.

Os chamados são processados um por vez, com a linha lida em destaque e uma barra de progresso, para mostrar visualmente a velocidade de cada método. Ao final, o app exibe tempo, custo e tokens de cada lado, com a diferença absoluta e o percentual entre eles.

## Como executar

1. Tenha o Node.js 18 ou superior instalado. Não há dependências para instalar.
2. Copie `.env.example` para `.env` e preencha as chaves:
   - `TYPESAFE_API_KEY` (obrigatória, usada pelo Jev);
   - a chave de pelo menos um LLM: `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY`;
   - `ANTHROPIC_WORKSPACE_ID` (opcional), necessário se a chave da Anthropic não for restrita a um workspace.
3. Inicie o servidor:

   ```
   npm start
   ```

4. Abra http://localhost:4180 (a porta pode ser trocada com `PORT` no `.env`).
5. Clique em **Analisar com Jev**. Depois escolha o LLM no seletor (DeepSeek Chat, Claude Haiku 4.5 ou OpenAI GPT-6 Luna) e clique em **Analisar com LLM**. A comparação aparece quando os dois terminam.

As chaves ficam só no servidor e nunca chegam ao navegador. Se uma chave estiver ausente, o app mostra um erro explícito e não simula respostas.

## Custo

O custo é estimado a partir dos tokens retornados pelas APIs e das tarifas por milhão de tokens definidas no `.env` (`*_INPUT_USD_PER_MTOK` e `*_OUTPUT_USD_PER_MTOK`). Confira a página de preços de cada fornecedor e ajuste os valores se necessário.

## Limitações

- O teste mede um cenário específico (12 chamados, execução sequencial). Modelo, região, cache e prompt mudam o resultado, então não é um benchmark universal.
- O LLM precisa gerar JSON em texto, que pode falhar; falhas de formato aparecem como erro no chamado.
- Sem gabarito, a concordância entre os métodos mostra onde eles divergem, não qual está certo.

## Arquivos

- `server.mjs`: servidor, chamadas ao Jev e aos LLMs, cálculo de custo.
- `public/`: interface (HTML, CSS e JS).
- `data/tickets.json`: chamados fictícios.
- `PROMPT_PARA_ALUNOS.md`: prompt para gerar este app com o Claude Code.
- `ROTEIRO_NARRACAO.md`: roteiro de narração do vídeo.


## sources
- [Jev quick install agents skill](https://docs.typesafe.ai/agent-skill)
- [Jev - documentação](https://docs.typesafe.ai/introduction)