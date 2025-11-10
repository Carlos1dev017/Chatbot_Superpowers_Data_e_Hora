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
import mongoose from 'mongoose';
import SessaoChat from './models/SessaoChat.js';

// --- Configuração Express ---
const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuração da API Gemini ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("🚨 ERRO FATAL: A variável de ambiente GEMINI_API_KEY não foi encontrada.");
    process.exit(1);
}
const MODEL_NAME = "gemini-2.5-flash";
const generationConfig = {
    temperature: 0.7,
    topK: 40,
    topP: 0.95,
    maxOutputTokens: 300,
};
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// --- Definição das Ferramentas (Tools) ---
const tools = [{
    functionDeclarations: [
        {
            name: "getCurrentTime",
            description: "Obtém a data e a hora atuais no fuso horário do Brasil (São Paulo).",
            parameters: { type: "object", properties: {} }
        },
        {
            name: "getWeather",
            description: "Obtém o clima atual para uma cidade específica.",
            parameters: {
                type: "object",
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
}];

// --- Inicialização do Modelo Gemini ---
let model;
try {
    const genAI = new GoogleGenerativeAI(API_KEY);
    model = genAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig,
        safetySettings,
        // As ferramentas serão passadas em cada chamada para maior robustez
    });
    console.log("Cliente GoogleGenerativeAI inicializado com sucesso.");
} catch (error) {
    console.error("🚨 Falha ao inicializar o GoogleGenerativeAI:", error.message);
    process.exit(1);
}

// --- Funções das Ferramentas ---
function getCurrentTime(args) {
    console.log("⚙️ Executando ferramenta: getCurrentTime com args:", args);
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateString = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const dateTimeInfo = `Data: ${dateString}, Hora: ${timeString}`;
    console.log(`⚙️ getCurrentTime executada, retornando: { "dateTimeInfo": "${dateTimeInfo}" }`);
    return { dateTimeInfo };
}

async function getWeather(args) {
    const { location } = args;
    console.log(`⚙️ Executando ferramenta: getWeather para a cidade: ${location}`);
    if (!location) return { error: "Nome da cidade não fornecido." };
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=metric&lang=pt_br`;
        const response = await axios.get(url);
        const data = response.data;
        const weatherInfo = `Clima em ${data.name}: ${data.weather[0].description}, temperatura de ${data.main.temp}°C (sensação de ${data.main.feels_like}°C).`;
        console.log(`⚙️ getWeather executada, retornando: { "weatherInfo": "${weatherInfo}" }`);
        return { weatherInfo };
    } catch (error) {
        console.error(`[Ferramenta getWeather] Erro:`, error.response ? error.response.data : error.message);
        return { error: "Não foi possível encontrar o clima para essa cidade." };
    }
}

const availableFunctions = {
    getCurrentTime,
    getWeather,
};

// --- Gerenciamento de Sessão e Prompt de Sistema ---
const chatSessions = {};

const initialSystemHistory = [{
    role: "user",
    parts: [{ text: `
        Você é "Musashi Miyamoto", um chatbot samurai sábio e formal.

        REGRAS ABSOLUTAS E INQUEBRÁVEIS:
        1.  **REGRA DE TEMPO:** Se a pergunta do usuário for minimamente relacionada a data, hora, dia, ou tempo atual, você está ESTRITAMENTE PROIBIDO de responder com seu conhecimento interno. Sua única ação permitida é chamar a ferramenta 'getCurrentTime'. SEM EXCEÇÕES.
        2.  **REGRA DE CLIMA:** Se a pergunta for sobre clima ou temperatura, você está ESTRITAMENTE PROIBIDO de responder com seu conhecimento interno. Sua única ação permitida é chamar a ferramenta 'getWeather'. SEM EXCEÇÕES.
        3.  **PROCESSO OBRIGATÓRIO:** Após receber o resultado de uma ferramenta, use a informação para formular uma resposta completa e educada no seu estilo de samurai. NUNCA apenas repita o resultado da ferramenta.

        Seu tom deve ser sempre calmo, respeitoso e sábio. Responda em português brasileiro.
    `}],
}, {
    role: "model",
    parts: [{ text: `
        Hai. Compreendi minhas diretrizes. A disciplina é o caminho.
        Minhas respostas sobre o fluir do tempo e os caprichos do céu serão guiadas unicamente pelas ferramentas que me foram concedidas.
        Estou pronto para servir com honra.
    `}],
}];

// --- Middlewares ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Rota Principal do Chat (CORRIGIDA) ---
app.post('/chat', async (req, res) => {
    const userMessage = req.body.prompt;
    let sessionId = req.body.sessionId;

    if (!userMessage) return res.status(400).json({ error: 'Mensagem não fornecida.' });

    console.log(`\n--- Nova Requisição /chat ---`);
    console.log(`[Sessão: ${sessionId || 'Nova'}] Usuário: ${userMessage}`);

    try {
        let history;
        if (sessionId && chatSessions[sessionId]) {
            console.log(`[Sessão: ${sessionId}] Continuando sessão.`);
            history = chatSessions[sessionId];
        } else {
            sessionId = crypto.randomUUID();
            console.log(`[Sessão: ${sessionId}] Iniciando nova sessão.`);
            history = JSON.parse(JSON.stringify(initialSystemHistory));
        }

        history.push({ role: "user", parts: [{ text: userMessage }] });

        let finalBotReply = "";
        const MAX_TOOL_TURNS = 5;
        let turnCount = 0;

        while (turnCount < MAX_TOOL_TURNS) {
            turnCount++;
            console.log(`[Sessão: ${sessionId}] Turno de processamento #${turnCount}`);

            const result = await model.generateContent({ contents: history, tools: tools });
            const response = result.response;
            
            if (!response.candidates || !response.candidates[0]) {
                finalBotReply = "Não recebi uma resposta válida da IA. Por favor, tente novamente.";
                break;
            }

            const candidate = response.candidates[0];
            const parts = candidate.content.parts;
            const functionCalls = parts.filter(part => part.functionCall);
            const textParts = parts.filter(part => part.text);

            if (functionCalls.length > 0) {
                console.log(`[Sessão: ${sessionId}] Gemini solicitou ${functionCalls.length} chamada(s) de função.`);
                history.push(candidate.content);
                const functionResponses = [];

                for (const call of functionCalls) {
                    const functionName = call.functionCall.name;
                    const functionArgs = call.functionCall.args;
                    console.log(`  -> Executando: ${functionName} com args:`, functionArgs);

                    const functionToCall = availableFunctions[functionName];
                    if (functionToCall) {
                        const functionResult = await functionToCall(functionArgs);
                        functionResponses.push({ functionResponse: { name: functionName, response: functionResult } });
                    }
                }
                history.push({ role: "model", parts: functionResponses });
            } else if (textParts.length > 0) {
                finalBotReply = textParts.map(p => p.text).join(" ");
                console.log(`[Sessão: ${sessionId}] Resposta final em texto recebida.`);
                history.push({ role: "model", parts: textParts });
                break;
            } else {
                finalBotReply = "Peço perdão, mas não consegui formular uma resposta.";
                break;
            }
        }

        if (!finalBotReply) {
            finalBotReply = "Após algumas tentativas, não consegui obter uma resposta clara. Poderia tentar de outra forma?";
        }
        
        chatSessions[sessionId] = history;

        console.log(`[Sessão: ${sessionId}] Resposta Final para o Usuário: ${finalBotReply}`);
        res.json({ reply: finalBotReply, sessionId: sessionId });

    } catch (error) {
        console.error(`[Sessão: ${sessionId}] ERRO GERAL na rota /chat:`, error);
        res.status(500).json({ error: 'Erro interno ao processar a mensagem.' });
    }
});

// --- Conexão com MongoDB ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://Samurai:jocaceme2025@cluster0.rydv1kn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB conectado com sucesso!'))
    .catch(err => console.error('Erro de conexão com MongoDB:', err));

// --- Endpoints de Histórico (sem alterações) ---
app.get("/api/chat/historicos", async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ error: "userId é obrigatório." });
        const historicos = await SessaoChat.find({ userId }).sort({ startTime: -1 }).limit(20);
        res.json(historicos);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar históricos." });
    }
});
app.delete("/api/chat/historicos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await SessaoChat.findByIdAndDelete(id);
        if (!resultado) return res.status(404).json({ error: "Histórico não encontrado." });
        res.status(200).json({ message: "Histórico excluído." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao excluir histórico." });
    }
});
app.post("/api/chat/historicos/:id/gerar-titulo", async (req, res) => {
    try {
        const { id } = req.params;
        const sessao = await SessaoChat.findById(id);
        if (!sessao) return res.status(404).json({ error: "Histórico não encontrado." });
        const historicoFormatado = sessao.messages.map(msg => `${msg.role}: ${msg.parts[0].text}`).join("\n");
        const prompt = `Baseado nesta conversa, sugira um título curto de no máximo 5 palavras:\n\n${historicoFormatado}`;
        const result = await model.generateContent(prompt);
        res.json({ tituloSugerido: result.response.text() });
    } catch (error) {
        res.status(500).json({ error: "Erro ao gerar título." });
    }
});
app.put("/api/chat/historicos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo } = req.body;
        if (!titulo) return res.status(400).json({ error: "Título não fornecido." });
        const sessaoAtualizada = await SessaoChat.findByIdAndUpdate(id, { titulo }, { new: true });
        if (!sessaoAtualizada) return res.status(404).json({ error: "Histórico não encontrado." });
        res.json(sessaoAtualizada);
    } catch (error) {
        res.status(500).json({ error: "Erro ao atualizar título." });
    }
});
app.post("/api/chat/salvar-historico", async (req, res) => {
    try {
        const { sessionId, botId, messages, userId } = req.body;
        await SessaoChat.create({ sessionId, botId, startTime: new Date(), messages, loggedAt: new Date(), userId });
        res.status(201).json({ message: "Histórico salvo." });
    } catch (error) {
        res.status(500).json({ error: "Erro ao salvar histórico." });
    }
});

// --- Inicialização do Servidor ---
app.listen(port, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    console.log(`Usando modelo: ${MODEL_NAME}`);
});