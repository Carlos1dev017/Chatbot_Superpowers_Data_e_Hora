const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');

// <<< CORREÇÃO 1: Defina a URL da API aqui, no topo do arquivo.
const API_URL = 'https://chatbot-samuria.onrender.com/api/chat';

// Histórico do cliente (opcional)
let clientHistory = [];

// --- Funções Auxiliares ---
function addMessage(message, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);
    messageDiv.innerText = message; // Usar innerText para interpretar quebras de linha (\n)
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator(show = true) {
    const existingIndicator = document.getElementById('typing');
    if (existingIndicator) existingIndicator.remove();

    if (show) {
        const typingDiv = document.createElement('div');
        typingDiv.classList.add('message', 'bot-message', 'typing-indicator');
        typingDiv.textContent = 'Meditando...';
        typingDiv.id = 'typing';
        chatBox.appendChild(typingDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

// --- Função Principal de Envio ---
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, 'user');
    clientHistory.push({ role: 'user', text: message });
    userInput.value = '';
    sendButton.disabled = true;
    showTypingIndicator();

    try {
        // <<< CORREÇÃO 2: Use a variável API_URL na chamada fetch.
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            // O corpo (body) está correto, enviando "prompt"
            body: JSON.stringify({ prompt: message }),
        });

        showTypingIndicator(false);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro do Servidor: ${response.status}`);
        }

        const data = await response.json();

        if (data.reply) {
            addMessage(data.reply, 'bot');
            clientHistory.push({ role: 'model', text: data.reply });
        } else {
             addMessage('Recebi uma resposta vazia do bot.', 'bot');
        }

    } catch (error) {
        showTypingIndicator(false);
        console.error('Erro ao enviar mensagem:', error);
        addMessage(`Ocorreu um erro de conexão: ${error.message}`, 'bot');
    } finally {
        sendButton.disabled = false;
        userInput.focus(); // Coloca o foco de volta no input
    }
}

// --- Event Listeners ---
sendButton.addEventListener('click', sendMessage);

userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});
