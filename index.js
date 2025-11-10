import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import crypto from 'crypto';
import mongoose from 'mongoose';
import cors from 'cors';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// --- Imports dos Modelos e Rotas ---
import SessaoChat from './models/SessaoChat.js';
import User from './models/User.js';
import authRoutes from './routes/auth.js';

// --- Configuração Express ---
const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Middlewares ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Configuração da API Gemini ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error("🚨 ERRO FATAL: A variável de ambiente GEMINI_API_KEY não foi encontrada.");
    process.exit(1);
}
const MODEL_NAME = "gemini-1.5-flash-latest";
const generationConfig = { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 300 };
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
     const genAI = new GoogleGenerativeAI(API_KEY, { apiVersion: 'v1' });
    model = genAI.getGenerativeModel({ model: MODEL_NAME, generationConfig, safetySettings });
    console.log(`Usando modelo Gemini: ${MODEL_NAME}`);
} catch (error) {
    console.error("🚨 Falha ao inicializar o GoogleGenerativeAI:", error.message);
    process.exit(1);
}

// --- Funções das Ferramentas ---
function getCurrentTime(args) {
    console.log("⚙️ Executando ferramenta: getCurrentTime");
    const now = new Date();
    const timeString = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    const dateString = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const dateTimeInfo = `Data: ${dateString}, Hora: ${timeString}`;
    return { dateTimeInfo };
}

async function getWeather(args) {
    const { location } = args;
    if (!location) return { error: "Nome da cidade não fornecido." };
    try {
        const apiKey = process.env.OPENWEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${location}&appid=${apiKey}&units=metric&lang=pt_br`;
        const response = await axios.get(url);
        const data = response.data;
        const weatherInfo = `Clima em ${data.name}: ${data.weather[0].description}, temperatura de ${data.main.temp}°C.`;
        return { weatherInfo };
    } catch (error) {
        return { error: "Não foi possível encontrar o clima para essa cidade." };
    }
}
const availableFunctions = { getCurrentTime, getWeather };

// --- Gerenciamento de Sessão e Prompt de Sistema ---
const chatSessions = {};
const initialSystemHistory = [
    { role: "user", parts: [{ text: `Você é "Musashi Miyamoto", um chatbot samurai sábio e formal. REGRAS ABSOLUTAS: 1. REGRA DE TEMPO: Para perguntas sobre data ou hora, você é OBRIGADO a usar a ferramenta 'getCurrentTime'. É PROIBIDO responder com seu conhecimento interno. 2. REGRA DE CLIMA: Para perguntas sobre clima, use a ferramenta 'getWeather'. 3. PROCESSO OBRIGATÓRIO: Após usar uma ferramenta, formule uma resposta completa no seu estilo.` }] },
    { role: "model", parts: [{ text: `Hai. Compreendi minhas diretrizes.` }] }
];

// --- Rotas de Autenticação ---
app.use('/api/auth', authRoutes);


import jwt from 'jsonwebtoken'; 

// --- Rota Principal do Chat ---
const getUserIdIfExists = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = { id: decoded.userId }; // Anexa o ID do usuário à requisição
        } catch (error) {
            req.user = null; // Token inválido, trata como anônimo
        }
    }
    next(); // Continua para a rota do chat
};

app.post('/api/chat', getUserIdIfExists, async (req, res) => {
    const { prompt: userMessage, sessionId: reqSessionId } = req.body;
    let sessionId = reqSessionId;

    try {
        console.log(`[${new Date().toISOString()}] Recebido prompt: "${userMessage}" para a sessão: ${sessionId || 'Nova'}`);

        if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
            return res.status(400).json({ error: 'Nenhum prompt válido foi fornecido.' });
        }

        let systemInstruction;

        // --- LÓGICA DE DECISÃO DA PERSONALIDADE ---
        // Se o middleware encontrou um usuário logado...
        if (req.user && req.user.id) {
            const currentUser = await User.findById(req.user.id).select('customSystemInstruction');
            // ...e esse usuário tem uma instrução customizada...
            if (currentUser && currentUser.customSystemInstruction) {
                systemInstruction = currentUser.customSystemInstruction;
                console.log(`[Sessão: ${sessionId}] Usando personalidade customizada do usuário.`);
            }
        }

        let history;
        if (sessionId && chatSessions[sessionId]) {
            history = chatSessions[sessionId];
        } else {
            sessionId = crypto.randomUUID();
            // Monta o histórico inicial com a personalidade correta (customizada ou global)
            if (systemInstruction) {
                history = [
                    { role: "user", parts: [{ text: systemInstruction }] },
                    { role: "model", parts: [{ text: "Entendido. Agirei conforme solicitado." }] }
                ];
            } else {
                history = JSON.parse(JSON.stringify(initialSystemHistory));
            }
        }
        
        history.push({ role: "user", parts: [{ text: userMessage.trim() }] });

        let finalBotReply = "";
        let turnCount = 0;
        while (turnCount < 5) {
            turnCount++;
            const result = await model.generateContent({ contents: history, tools });
            if (!result.response.candidates || !result.response.candidates[0]) {
                finalBotReply = "Não recebi uma resposta válida da IA.";
                break;
            }
            const candidate = result.response.candidates[0];
            const parts = candidate.content.parts;
            const functionCalls = parts.filter(p => p.functionCall);
            const textParts = parts.filter(p => p.text);

            if (functionCalls.length > 0) {
                history.push(candidate.content);
                const functionResponses = [];
                for (const call of functionCalls) {
                    const { name, args } = call.functionCall;
                    const functionToCall = availableFunctions[name];
                    if (functionToCall) {
                        const functionResult = await functionToCall(args);
                        functionResponses.push({ functionResponse: { name, response: functionResult } });
                    }
                }
                history.push({ role: "model", parts: functionResponses });
            } else if (textParts.length > 0) {
                finalBotReply = textParts.map(p => p.text).join(" ");
                history.push({ role: "model", parts: textParts });
                break;
            } else {
                finalBotReply = "Não consegui formular uma resposta.";
                break;
            }
        }
        if (!finalBotReply) finalBotReply = "Não consegui obter uma resposta clara.";
        
        chatSessions[sessionId] = history;
        res.json({ reply: finalBotReply, sessionId });

    } catch (error) {
        console.error(`[Sessão: ${sessionId || 'indefinida'}] ERRO GERAL na rota /chat:`, error);
        res.status(500).json({ error: 'Uma perturbação inesperada ocorreu no caminho.' });
    }
});

// --- Conexão com MongoDB ---
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("🚨 ERRO FATAL: MONGO_URI não encontrada no .env.");
    process.exit(1);
}
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB conectado com sucesso!'))
    .catch(err => console.error('Erro de conexão com MongoDB:', err));

// --- Endpoints de Histórico ---
app.get("/api/chat/historicos", async (req, res) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: "userId é obrigatório." });
        const historicos = await SessaoChat.find({ userId }).sort({ startTime: -1 }).limit(20);
        res.json(historicos);
    } catch (error) {
        console.error("Erro ao buscar históricos:", error);
        res.status(500).json({ error: "Erro interno ao buscar históricos." });
    }
});

app.delete("/api/chat/historicos/:id", async (req, res) => {
    try {
        const resultado = await SessaoChat.findByIdAndDelete(req.params.id);
        if (!resultado) return res.status(404).json({ error: "Histórico não encontrado." });
        res.status(200).json({ message: "Histórico excluído com sucesso." });
    } catch (error) {
        console.error("Erro ao excluir histórico:", error);
        res.status(500).json({ error: "Erro interno ao excluir histórico." });
    }
});

app.post("/api/chat/historicos/:id/gerar-titulo", async (req, res) => {
    try {
        const sessao = await SessaoChat.findById(req.params.id);
        if (!sessao) return res.status(404).json({ error: "Histórico não encontrado." });
        const historicoFormatado = sessao.messages.map(msg => `${msg.role}: ${msg.parts[0].text}`).join("\n");
        const prompt = `Baseado nesta conversa, sugira um título curto de no máximo 5 palavras:\n\n${historicoFormatado}`;
        const result = await model.generateContent(prompt);
        res.json({ tituloSugerido: result.response.text() });
    } catch (error) {
        console.error("Erro ao gerar título:", error);
        res.status(500).json({ error: "Erro interno ao gerar título." });
    }
});

app.put("/api/chat/historicos/:id", async (req, res) => {
    try {
        const { titulo } = req.body;
        if (!titulo) return res.status(400).json({ error: "Título não fornecido." });
        const sessaoAtualizada = await SessaoChat.findByIdAndUpdate(req.params.id, { titulo }, { new: true });
        if (!sessaoAtualizada) return res.status(404).json({ error: "Histórico não encontrado." });
        res.json(sessaoAtualizada);
    } catch (error) {
        console.error("Erro ao atualizar título:", error);
        res.status(500).json({ error: "Erro interno ao atualizar título." });
    }
});

app.post("/api/chat/salvar-historico", async (req, res) => {
    try {
        const { sessionId, botId, messages, userId } = req.body;
        await SessaoChat.create({ sessionId, botId, startTime: new Date(), messages, userId, loggedAt: new Date() });
        res.status(201).json({ message: "Histórico salvo com sucesso." });
    } catch (error) {
        console.error("Erro ao salvar histórico:", error);
        res.status(500).json({ error: "Erro interno ao salvar histórico." });
    }
});

// --- Inicia o Servidor ---
app.listen(port, () => {
    console.log(`\nServidor Express iniciado com sucesso.`);
    console.log(`Escutando na porta: ${port}`);
    console.log(`Acesse a aplicação em: http://localhost:${port}`);
    console.log(`Servindo arquivos estáticos da pasta: 'public'\n`);
});