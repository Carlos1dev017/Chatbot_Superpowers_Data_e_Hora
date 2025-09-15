import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
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
                description: "Obtém a data e a hora atuais no fuso horário do Brasil (São Paulo).",
                parameters: {
                    type: "object", // Corrigido para minúsculo
                    properties: {},
                }
            },
            {
                name: "getWeather",
                description: "Obtém o clima atual para uma cidade específica.",
                parameters: {
                    type: "object", // Corrigido para minúsculo
                    properties: {
                        location: {
                            type: "string",
                            description: "A cidade para a qual se deve obter o clima, por exemplo, 'São Paulo'."
                        }
                    },
                    required: ["location"]
                }
            }
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
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateString = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const dateTimeInfo = `Data: ${dateString}, Hora: ${timeString}`;
    console.log(`⚙️ getCurrentTime executada, retornando: { "dateTimeInfo": "${dateTimeInfo}" }`);
    return { dateTimeInfo: dateTimeInfo };
}


async function getWeather(args) {
    const { location } = args;
    console.log(`⚙️ Executando ferramenta: getWeather para a cidade: ${location}`);
    if (!location) {
        return { error: "Nome da cidade não fornecido." };
    }
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=metric&lang=pt_br`;
        
        const response = await axios.get(url);
        const data = response.data;
        
        const weatherInfo = `Clima em ${data.name}: ${data.weather[0].description}, temperatura de ${data.main.temp}°C (sensação de ${data.main.feels_like}°C).`;
        console.log(`⚙️ getWeather executada, retornando: { "weatherInfo": "${weatherInfo}" }`);
        return { weatherInfo: weatherInfo };
    } catch (error) {
        console.error(`[Ferramenta getWeather] Erro:`, error.response ? error.response.data : error.message);
        return { error: "Não foi possível encontrar o clima para essa cidade." };
    }
}

const availableFunctions = {
    getCurrentTime: getCurrentTime,
    getWeather: getWeather,
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
            Por exemplo, se a ferramenta retornar "Data: 01/01/2024, Hora: 10:30", você poderia dizer: "Pequeno gafanhoto, os ventos do tempo sussurram que agora são 10:30 do dia 01/01/2024." Não responda apenas com a informação da ferramenta, incorpore-a em uma frase completa no seu estilo.
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
    const userMessage = req.body.prompt;
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

import mongoose from 'mongoose';
import SessaoChat from './models/SessaoChat.js';

// Conexão com MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Samurai:jocaceme2025@cluster0.rydv1kn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB conectado com sucesso!'))
    .catch(err => console.error('Erro de conexão com MongoDB:', err));




// Endpoint para buscar históricos de chat
app.get("/api/chat/historicos", async (req, res) => {
    try {
        const userId = req.query.userId; // Espera o userId como query parameter
        if (!userId) {
            return res.status(400).json({ error: "userId é obrigatório para buscar históricos." });
        }
        const historicos = await SessaoChat.find({ userId }).sort({ startTime: -1 }).limit(20);
        res.json(historicos);
    } catch (error) {
        console.error("Erro ao buscar históricos:", error);
        res.status(500).json({ error: "Erro interno ao buscar históricos de chat." });
    }
});

// Endpoint para deletar um histórico de chat
app.delete("/api/chat/historicos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await SessaoChat.findByIdAndDelete(id);
        if (!resultado) {
            return res.status(404).json({ error: "Histórico não encontrado." });
        }
        res.status(200).json({ message: "Histórico excluído com sucesso." });
    } catch (error) {
        console.error("Erro ao excluir histórico:", error);
        res.status(500).json({ error: "Erro interno ao excluir histórico." });
    }
});

// Endpoint para gerar um título para a conversa
app.post("/api/chat/historicos/:id/gerar-titulo", async (req, res) => {
    try {
        const { id } = req.params;
        const sessao = await SessaoChat.findById(id);
        if (!sessao) {
            return res.status(404).json({ error: "Histórico não encontrado." });
        }

        const historicoFormatado = sessao.messages.map(msg => `${msg.role}: ${msg.parts[0].text}`).join("\n");
        const prompt = `Baseado nesta conversa, sugira um título curto e conciso de no máximo 5 palavras:\n\n${historicoFormatado}`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        res.json({ tituloSugerido: text });

    } catch (error) {
        console.error("Erro ao gerar título:", error);
        res.status(500).json({ error: "Erro interno ao gerar título." });
    }
});

// Endpoint para atualizar o título da conversa
app.put("/api/chat/historicos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo } = req.body;

        if (!titulo) {
            return res.status(400).json({ error: "Título não fornecido." });
        }

        const sessaoAtualizada = await SessaoChat.findByIdAndUpdate(id, { titulo }, { new: true });

        if (!sessaoAtualizada) {
            return res.status(404).json({ error: "Histórico não encontrado." });
        }

        res.json(sessaoAtualizada);

    } catch (error) {
        console.error("Erro ao atualizar título:", error);
        res.status(500).json({ error: "Erro interno ao atualizar título." });
    }
});

// Lógica para salvar o histórico da conversa
app.post("/api/chat/salvar-historico", async (req, res) => {
    try {
        const { sessionId, botId, messages, userId } = req.body;

        const novaSessao = new SessaoChat({
            sessionId,
            botId,
            startTime: new Date(),
            messages,
            loggedAt: new Date(),
            userId // Adiciona o userId aqui
        });

        await novaSessao.save();
        res.status(201).json({ message: "Histórico salvo com sucesso." });

    } catch (error) {
        console.error("Erro ao salvar histórico:", error);
        res.status(500).json({ error: "Erro interno ao salvar histórico." });
    }
});
