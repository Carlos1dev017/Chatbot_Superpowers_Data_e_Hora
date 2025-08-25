import express from 'express';
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config(); // Carrega as variáveis do .env PRIMEIRO

// --- Configuração opcional para __dirname se precisar (não usado neste código) ---
// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
// ---

const app = express();
const port = 3000;

// --- Middlewares ---

app.use(cors());

app.use(express.static('public'));

// 2. Parsear corpos de requisição JSON (essencial para req.body)
app.use(express.json());

// --- Configuração do Google Generative AI ---
// Verifica se a chave API foi carregada
if (!process.env.GOOGLE_API_KEY) {
    console.error("!!! ERRO FATAL: GOOGLE_API_KEY não encontrada no .env !!!");
    process.exit(1); // Encerra o processo se a chave estiver faltando
}
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Obter o modelo generativo - Usando gemini-1.5-flash-latest
// Removidas configs de geração/segurança temporariamente para teste
console.log("Usando modelo Gemini: gemini-1.5-flash-latest");
const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash-latest"
  // generationConfig e safetySettings omitidos por enquanto para simplificar
});

// --- Endpoint da API para o Chat ---
app.post('/api/chat', async (req, res) => {
    const userPrompt = req.body.prompt; // Pega o prompt do corpo da requisição
    console.log(`[${new Date().toISOString()}] Recebido prompt: "${userPrompt}"`); // Log com timestamp

    try {
        // Validação do prompt
        if (!userPrompt || typeof userPrompt !== 'string' || userPrompt.trim() === '') {
            console.warn("Alerta: Prompt inválido ou vazio recebido."); // Use warn para avisos
            return res.status(400).json({ error: 'Nenhum prompt válido foi fornecido.' }); // Retorna 400 Bad Request
        }

        // Inicia uma sessão de chat
        // Removidos history e generationConfig aqui também para simplificar testes
        const chat = model.startChat({
           history: [] // Começa com histórico vazio (ou gerencie o histórico se necessário)
           // generationConfig e safetySettings omitidos
        });

        // Envia a mensagem do usuário para a sessão de chat
        console.log("Enviando prompt para a API Gemini...");
        const result = await chat.sendMessage(userPrompt.trim()); // Usa trim() para limpar espaços extras

        // Obtém a resposta
        const response = result.response;

        // Validação robusta da resposta
        if (!response || typeof response.text !== 'function') {
           console.error("!!! Resposta inesperada da API Gemini:", response);
           // Lança um erro para ser pego pelo bloco catch
           throw new Error("Formato de resposta inválido recebido da API Gemini.");
        }

        // Extrai o texto da resposta
        const text = response.text();
        console.log(`[${new Date().toISOString()}] Resposta da IA: "${text}"`); // Log com timestamp

        // Envia a resposta da IA de volta para o frontend
        res.json({ reply: text });

    } catch (error) {
    console.error(`[Sessão: ${sessionId}] ERRO GERAL na rota /chat:`, error.message || error);
    
    // <<< NOVO CÓDIGO INTELIGENTE AQUI >>>
    // A biblioteca do Google anexa o status HTTP ao objeto de erro em `error.cause.status` ou `error.status`
    const status = error.cause?.status || error.status; 
    
    if (status) {
        if (status === 503) {
            return res.status(503).json({ 
                error: "Peço perdão. Meu espírito digital (a API do Google) encontra-se sobrecarregado no momento. Por favor, aguarde um instante e tente novamente."
            });
        }
        if (status === 429) {
            return res.status(429).json({ 
                error: "Muitos movimentos em pouco tempo. A disciplina exige uma pausa. Por favor, aguarde um momento."
            });
        }
    }
        // --- Fim do Tratamento de Erro Aprimorado ---

        // Envia uma resposta genérica 500 para o cliente
        // IMPORTANTE: Não envie detalhes internos do erro para o cliente por segurança
        res.status(500).json({ error: 'Uma perturbação inesperada ocorreu no caminho. Um erro interno impediu a comunicação.' });
    }
});

// --- Inicia o Servidor ---
app.listen(port, () => {
    console.log(`\nServidor Express iniciado com sucesso.`);
    console.log(`Escutando na porta: ${port}`);
    console.log(`Acesse a aplicação em: http://localhost:${port}`);
    console.log(`Servindo arquivos estáticos da pasta: 'public'`);
    console.log(`Pressione CTRL+C para parar o servidor.\n`);
});

// --- Tratamento para Encerramento Gracioso (Opcional mas bom) ---
process.on('SIGINT', () => {
    console.log('\nRecebido SIGINT (Ctrl+C). Encerrando o servidor...');
    // Aqui você pode adicionar lógicas de limpeza se necessário (ex: fechar DB)
    process.exit(0);
});