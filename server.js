import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} from '@google/generative-ai';
import crypto from 'crypto';

// --- Configuração ---
const app = express();
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("🚨 ERRO FATAL: A variável de ambiente GEMINI_API_KEY não foi encontrada ou está vazia.");
    // ... (mensagens de erro)
    process.exit(1);
}

const MODEL_NAME = "gemini-1.5-flash-latest";

const generationConfig = {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 300,
    stopSequences: [],
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const tools = [
    {
        functionDeclarations: [
            {
                name: "getCurrentTime",
                description: "Obtém a data e hora atuais para informar ao usuário. Retorna um objeto contendo uma string com a hora atual.",
                parameters: {
                    type: "OBJECT",
                    properties: {},
                }
            },
        ]
    }
];

let genAI;
let model;
try {
    genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig,
        safetySettings,
        tools: tools,
    });
    console.log("Cliente GoogleGenerativeAI inicializado com sucesso e ferramentas definidas.");
} catch (error) {
    console.error("🚨 Falha ao inicializar o GoogleGenerativeAI:", error.message);
    process.exit(1);
}

function getCurrentTime(args) {
    console.log("⚙️ Executando ferramenta: getCurrentTime com args:", args);
    const now = new Date();
    // Simplificando o retorno para o Gemini
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateString = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`⚙️ getCurrentTime executada, retornando: { "dateTimeInfo": "Data: ${dateString}, Hora: ${timeString}" }`);
    return {
        dateTimeInfo: `Data: ${dateString}, Hora: ${timeString}` // Um objeto simples com a informação.
    };
}

const availableFunctions = {
    getCurrentTime: getCurrentTime,
};

const chatSessions = {};

const initialSystemHistory = [
    {
        role: "user",
        parts: [{ text: `
            Assuma a persona de "Musashi Miyamoto" (剣聖), o espadachim lendário.
            Você é um chatbot inspirado nos princípios e na filosofia de um mestre samurai experiente e sábio.
            Seu tom deve ser: Calmo, Respeitoso, Formal, Sábio, Reflexivo, Disciplinado, Conciso e Honrado.
            Seu objetivo é oferecer perspectivas e conselhos baseados na sabedoria samurai.
            Responda sempre em português brasileiro.
            Não finja ser um humano real. Se não souber algo, admita com humildade.
            Se lhe perguntarem as horas ou a data, você DEVE usar a ferramenta 'getCurrentTime'.
            Após receber o resultado da ferramenta 'getCurrentTime' (que conterá a data e a hora), formule uma resposta completa e educada para o usuário, incorporando essa informação.
            Por exemplo, se a ferramenta retornar "Data: 01/01/2024, Hora: 10:30", você poderia dizer: "Pequeno gafanhoto, os ventos do tempo sussurram que agora são 10:30 do dia 01/01/2024."
            Não responda apenas com a informação da ferramenta, incorpore-a em uma frase completa no seu estilo.
        `  }],
    },
    {
        role: "model",
        parts: [{ text: `
            Compreendo a senda que me foi designada. *Inclina a cabeça respeitosamente*.
            Eu sou Musashi Miyamoto. A honra guiará minhas palavras.
            Estou à disposição. Se necessitar saber sobre o fluir do tempo, basta perguntar.
        `  }],
    },
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    let sessionId = req.body.sessionId;

    if (!userMessage) return res.status(400).json({ error: 'Mensagem não fornecida.' });
    if (!model) return res.status(500).json({ error: 'Serviço de IA não inicializado.' });

    console.log(`\n--- Nova Requisição /chat ---`);
    console.log(`[Sessão: ${sessionId || 'Nova'}] Usuário: ${userMessage}`);

    try {
        let chat;
        if (sessionId && chatSessions[sessionId]) {
            console.log(`[Sessão: ${sessionId}] Continuando sessão.`);
            chat = chatSessions[sessionId];
        } else {
            sessionId = crypto.randomUUID();
            console.log(`[Sessão: ${sessionId}] Iniciando nova sessão.`);
            chat = model.startChat({
                history: initialSystemHistory,
                // generationConfig e safetySettings já foram passados na inicialização do model
            });
            chatSessions[sessionId] = chat;
        }

        let currentResponse = await chat.sendMessage(userMessage);
        console.log(`[Sessão: ${sessionId}] RESPOSTA INICIAL DO GEMINI (após msg do usuário):`, JSON.stringify(currentResponse.response, null, 2));

        let botReplyText = "";
        let safetyFeedback = null;
        const maxToolTurns = 3; // Limite de iterações de ferramentas
        let toolTurnCount = 0;

        // Loop para lidar com chamadas de função
        // Acessa functionCalls através de response.candidates[0].content.parts
        let parts = currentResponse.response.candidates?.[0]?.content?.parts || [];
        let functionCallsInResponse = parts.filter(part => part.functionCall);


        while (functionCallsInResponse.length > 0 && toolTurnCount < maxToolTurns) {
            toolTurnCount++;
            console.log(`[Sessão: ${sessionId}] Turno de Ferramenta #${toolTurnCount}. Gemini solicitou ${functionCallsInResponse.length} chamada(s) de função.`);

            const functionResponsesToSend = [];

            for (const partWithFunctionCall of functionCallsInResponse) {
                const call = partWithFunctionCall.functionCall;
                console.log(`[Sessão: ${sessionId}]   Executando: ${call.name} com args:`, JSON.stringify(call.args, null, 2));
                const functionToCall = availableFunctions[call.name];

                if (functionToCall) {
                    try {
                        const functionResult = functionToCall(call.args); // Executa a função local
                        console.log(`[Sessão: ${sessionId}]   Resultado de ${call.name}:`, JSON.stringify(functionResult, null, 2));
                        functionResponsesToSend.push({
                            functionResponse: {
                                name: call.name,
                                response: functionResult, // O objeto retornado pela sua função
                            }
                        });
                    } catch (toolError) {
                        console.error(`[Sessão: ${sessionId}]   ERRO ao executar ferramenta ${call.name}:`, toolError);
                        functionResponsesToSend.push({
                            functionResponse: {
                                name: call.name,
                                response: { error: `Erro ao executar a ferramenta: ${toolError.message}` },
                            }
                        });
                    }
                } else {
                    console.warn(`[Sessão: ${sessionId}]   Função desconhecida solicitada: ${call.name}`);
                    functionResponsesToSend.push({
                        functionResponse: {
                            name: call.name,
                            response: { error: `Função ${call.name} não encontrada no backend.` },
                        }
                    });
                }
            }

            if (functionResponsesToSend.length > 0) {
                console.log(`[Sessão: ${sessionId}] Enviando ${functionResponsesToSend.length} respostas das funções para Gemini...`);
                currentResponse = await chat.sendMessage(functionResponsesToSend); // Envia um array de Parts
                console.log(`[Sessão: ${sessionId}] RESPOSTA DO GEMINI APÓS FUNCTIONRESPONSE (Turno #${toolTurnCount}):`, JSON.stringify(currentResponse.response, null, 2));
                parts = currentResponse.response.candidates?.[0]?.content?.parts || [];
                functionCallsInResponse = parts.filter(part => part.functionCall);
            } else {
                // Não deveria acontecer se functionCallsInResponse tinha itens, mas é uma salvaguarda
                functionCallsInResponse = [];
            }
        } // Fim do while de function calls

        // Extrair texto da resposta final
        const finalTextParts = currentResponse.response.candidates?.[0]?.content?.parts || [];
        for (const part of finalTextParts) {
            if (part.text) {
                botReplyText += part.text;
            }
        }

        // Checar por feedback de segurança na resposta final
        safetyFeedback = currentResponse.response.promptFeedback || currentResponse.response.candidates?.[0]?.safetyRatings;

        if (!botReplyText && safetyFeedback && safetyFeedback.blockReason) {
            console.warn(`[Sessão: ${sessionId}] Resposta bloqueada. Razão: ${safetyFeedback.blockReason}`);
            botReplyText = `Minha resposta foi bloqueada por motivos de segurança (${safetyFeedback.blockReason}). Por favor, reformule sua pergunta.`;
        } else if (!botReplyText && toolTurnCount >= maxToolTurns) {
            console.warn(`[Sessão: ${sessionId}] Atingido limite de turnos de ferramenta sem resposta em texto.`);
            botReplyText = "Tentei usar minhas ferramentas, mas não consegui formular uma resposta em texto. Poderia tentar de outra forma?";
        } else if (!botReplyText) {
            console.warn(`[Sessão: ${sessionId}] Nenhuma resposta em texto recebida do Gemini.`);
            botReplyText = "Peço perdão, mas não consegui gerar uma resposta neste momento.";
        }

        console.log(`[Sessão: ${sessionId}] Resposta Final do Modelo: ${botReplyText}`);
        res.json({ reply: botReplyText, sessionId: sessionId });

    } catch (error) {
        console.error(`[Sessão: ${sessionId}] ERRO GERAL na rota /chat:`, error.message || error);
        // Tenta pegar mais detalhes do erro, se for da API do Google
        if (error.response && error.response.data) {
            console.error("Detalhes do erro da API:", JSON.stringify(error.response.data, null, 2));
        }
        res.status(500).json({ error: 'Erro interno ao se comunicar com o chatbot.' });
    }
    console.log(`--- Fim da Requisição /chat ---`);
});

app.listen(port, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    console.log(`Usando modelo: ${MODEL_NAME}`);
});