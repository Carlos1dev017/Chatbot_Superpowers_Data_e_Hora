# Musashi Miyamoto - O Bot Samurai

"Saudações, viajante. Eu sou Musashi Miyamoto — um bot forjado no espírito do lendário guerreiro samurai. Se procuras os grandes ensinamentos do Caminho da Estratégia, basta falar comigo. Com a lâmina da sabedoria e o escudo da honra, guiarei tua mente e teu espírito pelos caminhos dos Samurais, até que alcances a verdadeira maestria no Caminho da Espada"

Para usar o bot:

## Pré-requisitos:

*   Node.js (versão recomendada: 18.x ou superior)
*   npm (geralmente vem com o Node.js)
*   Uma API Key válida da API Gemini (Google Generative AI). Você pode obter uma no [Google AI Studio](https://aistudio.google.com/app/apikey).

## Instalação:

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/Carlos1dev017/Chat-bot.git
    cd Chat-bot-main
    ```
    (Ou se você já tem o código, navegue até o diretório do projeto `Chat-bot-main`)

2.  **Instale as dependências:**
    Este comando lerá o arquivo `package.json` e instalará todos os pacotes necessários (como Express, Dotenv e a biblioteca da API Gemini).
    ```bash
    npm install
    ```

3.  **Configure sua API Key:**
    *   Crie um arquivo chamado `.env` na raiz do diretório do projeto (no mesmo nível que `server.js` e `package.json`).
    *   Adicione a seguinte linha ao arquivo `.env`, substituindo `SUA_CHAVE_DE_API_REAL_AQUI` pela sua API Key do Gemini:
        ```env
        GEMINI_API_KEY="SUA_CHAVE_DE_API_REAL_AQUI"
        ```

4.  **Inicie o servidor:**
    ```bash
    node server.js
    ```
    Ou, se você tiver o `nodemon` instalado para desenvolvimento:
    ```bash
    nodemon server.js
    ```
    Você deverá ver uma mensagem no console indicando que o servidor está rodando, geralmente em `http://localhost:3000`.

5.  **Acesse o Chatbot:**
    Abra seu navegador e vá para `http://localhost:3000`.

## Recursos do Bot

### Fornecendo a Data e Hora Atuais com "Function Calling"

Este chatbot utiliza um recurso avançado da API Gemini chamado **Function Calling** (ou "Uso de Ferramentas") para interagir com o mundo exterior e fornecer informações dinâmicas, como a data e hora atuais.

**O que é Function Calling?**

Function Calling permite que o modelo de linguagem (LLM), como o Gemini, não apenas gere texto, mas também solicite a execução de código customizado no backend (nosso servidor Node.js) quando ele determina que precisa de informações ou capacidades que não possui internamente.

O fluxo geral é o seguinte:

1.  **Definição da Ferramenta:** No código do nosso backend, definimos uma "ferramenta" que o bot pode usar. Para a data e hora, definimos uma ferramenta chamada `getCurrentTime`. Essa definição inclui:
    *   Um nome (`getCurrentTime`).
    *   Uma descrição do que a ferramenta faz (ex: "Obtém a data e hora atuais para informar ao usuário.").
    *   Quaisquer parâmetros que a ferramenta possa precisar (neste caso, nenhum).
2.  **Interação do Usuário:** O usuário faz uma pergunta que requer essa ferramenta (ex: "Musashi, que horas são?").
3.  **Detecção pelo Gemini:** A API Gemini analisa a pergunta e, com base na descrição da ferramenta `getCurrentTime` e no contexto da conversa, entende que precisa executar essa função para responder.
4.  **Solicitação de `functionCall`:** Em vez de responder diretamente, a API Gemini retorna uma solicitação especial para o nosso backend, indicando:
    *   O nome da função a ser executada (`getCurrentTime`).
    *   Quaisquer argumentos necessários (neste caso, nenhum).
5.  **Execução no Backend:** Nosso servidor Node.js:
    *   Recebe essa solicitação de `functionCall`.
    *   Localiza e executa a função JavaScript `getCurrentTime` correspondente.
    *   Essa função obtém a data e hora atuais do sistema.
6.  **Envio do Resultado de Volta:** O backend envia o resultado da execução da função (a data e hora) de volta para a API Gemini.
7.  **Formulação da Resposta Final:** A API Gemini recebe o resultado da função e o utiliza para formular uma resposta final em linguagem natural para o usuário, no estilo da persona Musashi Miyamoto (ex: "Pequeno gafanhoto, os ventos do tempo sussurram que agora são 10:30 do dia 01/01/2024.").

**Como o Bot Fornece a Data e Hora Atuais:**

*   **Pergunta do Usuário:** Simplesmente pergunte ao bot algo como:
    *   "Que horas são?"
    *   "Qual a data de hoje?"
    *   "Poderia me dizer a data e hora, por favor?"
*   **Mágica do Backend:** O sistema de Function Calling descrito acima é ativado.
*   **Resposta de Musashi:** O bot responderá com a data e hora atuais, integradas em sua persona samurai.

**Configuração do Backend (para Desenvolvedadores):**

A funcionalidade de `getCurrentTime` está implementada no arquivo `server.js` (ou seu arquivo principal do servidor Node.js) e envolve os seguintes componentes principais:

1.  **Declaração da Ferramenta (`tools`):**
    ```javascript
    const tools = [
        {
            functionDeclarations: [
                {
                    name: "getCurrentTime",
                    description: "Obtém a data e hora atuais para informar ao usuário. Retorna um objeto contendo uma string com a hora atual.", // Descrição crucial!
                    parameters: {
                        type: "OBJECT",
                        properties: {}, // Sem parâmetros de entrada para esta função
                    }
                },
            ]
        }
    ];
    ```
2.  **Inicialização do Modelo com as Ferramentas:**
    ```javascript
    model = genAI.getGenerativeModel({
        model: MODEL_NAME, // Ex: "gemini-1.5-flash-latest"
        // ... outras configs ...
        tools: tools, // As ferramentas são passadas aqui
    });
    ```
3.  **Implementação da Função JavaScript:**
    ```javascript
    function getCurrentTime(args) {
        // ... lógica para obter new Date() ...
        const now = new Date();
        const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
        const dateString = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        return {
            dateTimeInfo: `Data: ${dateString}, Hora: ${timeString}`
        };
    }
    ```
4.  **Mapeamento de Funções Disponíveis:**
    ```javascript
    const availableFunctions = {
        getCurrentTime: getCurrentTime
    };
    ```
5.  **Lógica na Rota `/chat` para Processar `functionCall`:**
    *   Detectar quando a API Gemini retorna um `functionCall`.
    *   Usar `availableFunctions` para executar a função correta.
    *   Enviar o resultado da função de volta para a API Gemini usando `chat.sendMessage()` com um payload de `functionResponse`.
    *   Receber e processar a resposta final em texto do Gemini.

*Observação: Este projeto implementa o Function Calling diretamente no backend Node.js. Se você estivesse usando o Google AI Studio, a configuração da ferramenta seria feita através da interface gráfica da plataforma, mas o conceito subjacente é o mesmo.*

## Estrutura do Projeto (Simplificada)