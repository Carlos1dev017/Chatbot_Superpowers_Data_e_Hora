const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");

const API_URL = "https://chatbot-samuria.onrender.com/api/chat";

let clientHistory = [];
let currentSessionId = localStorage.getItem("currentChatSessionId") || null;
let currentUserId = localStorage.getItem("currentUserId") || `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
localStorage.setItem("currentUserId", currentUserId);

function addMessage(message, sender) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", `${sender}-message`);
    messageDiv.innerText = message;
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function showTypingIndicator(show = true) {
    const existingIndicator = document.getElementById("typing");
    if (existingIndicator) existingIndicator.remove();

    if (show) {
        const typingDiv = document.createElement("div");
        typingDiv.classList.add("message", "bot-message", "typing-indicator");
        typingDiv.textContent = "Meditando...";
        typingDiv.id = "typing";
        chatBox.appendChild(typingDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message) return;

    addMessage(message, "user");
    clientHistory.push({ role: "user", parts: [{ text: message }] });
    userInput.value = "";
    sendButton.disabled = true;
    showTypingIndicator();

    try {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ prompt: message, sessionId: currentSessionId }),
        });

        showTypingIndicator(false);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Erro do Servidor: ${response.status}`);
        }

        const data = await response.json();

        if (data.reply) {
            addMessage(data.reply, "bot");
            clientHistory.push({ role: "model", parts: [{ text: data.reply }] });
            currentSessionId = data.sessionId;

            await salvarHistorico(currentSessionId, "Musashi Miyamoto", clientHistory, currentUserId);

        } else {
             addMessage("Recebi uma resposta vazia do bot.", "bot");
        }

    } catch (error) {
        showTypingIndicator(false);
        console.error("Erro ao enviar mensagem:", error);
        addMessage(`Ocorreu um erro de conexão: ${error.message}`, "bot");
    } finally {
        sendButton.disabled = false;
        userInput.focus();
    }
}

sendButton.addEventListener("click", sendMessage);

userInput.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
        sendMessage();
    }
});

const historicoContainer = document.getElementById("historico-container");
const listaSessoes = document.getElementById("lista-sessoes");
const visualizacaoConversaDetalhada = document.getElementById("visualizacao-conversa-detalhada");

async function carregarHistoricoSessoes() {
    try {
        const response = await fetch(`/api/chat/historicos?userId=${currentUserId}`);
        if (!response.ok) {
            throw new Error(`Erro ao carregar histórico: ${response.statusText}`);
        }
        const historicos = await response.json();

        listaSessoes.innerHTML = "";
        historicos.forEach(sessao => {
            const li = document.createElement("li");
            const dataHora = new Date(sessao.startTime).toLocaleString("pt-BR");
            li.innerHTML = `
                <span>${sessao.titulo || `Conversa de ${dataHora}`}</span>
                <div>
                    <button class="btn-gerar-titulo" data-id="${sessao._id}">✏️</button>
                    <button class="btn-excluir" data-id="${sessao._id}">🗑️</button>
                </div>
            `;
            li.addEventListener("click", (event) => {
                if (!event.target.closest("button")) {
                    exibirConversaDetalhada(sessao.messages);
                }
            });
            listaSessoes.appendChild(li);
        });

        document.querySelectorAll(".btn-gerar-titulo").forEach(button => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                const sessionId = event.target.dataset.id;
                const liElement = event.target.closest("li");
                await obterESalvarTitulo(sessionId, liElement);
            });
        });

        document.querySelectorAll(".btn-excluir").forEach(button => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                const sessionId = event.target.dataset.id;
                await excluirSessao(sessionId);
            });
        });

    } catch (error) {
        console.error("Erro ao carregar histórico de sessões:", error);
        alert(`Erro ao carregar histórico: ${error.message}`);
    }
}

function exibirConversaDetalhada(mensagens) {
    visualizacaoConversaDetalhada.innerHTML = "";
    mensagens.forEach(msg => {
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", `${msg.role}-message`);
        messageDiv.innerText = msg.parts[0].text;
        visualizacaoConversaDetalhada.appendChild(messageDiv);
    });
    visualizacaoConversaDetalhada.scrollTop = visualizacaoConversaDetalhada.scrollHeight;
}

async function excluirSessao(sessionId) {
    if (confirm("Tem certeza que deseja excluir esta conversa?\nEsta ação não pode ser desfeita.")) {
        try {
            const response = await fetch(`/api/chat/historicos/${sessionId}`, {
                method: "DELETE",
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || "Erro ao excluir conversa.");
            }

            alert("Conversa excluída com sucesso!");
            carregarHistoricoSessoes();

        } catch (error) {
            console.error("Erro ao excluir sessão:", error);
            alert(`Erro ao excluir conversa: ${error.message}`);
        }
    }
}

async function obterESalvarTitulo(sessionId, liElement) {
    try {
        const responseGerar = await fetch(`/api/chat/historicos/${sessionId}/gerar-titulo`, {
            method: "POST",
        });
        if (!responseGerar.ok) {
            const errorData = await responseGerar.json();
            throw new Error(errorData.error || "Erro ao gerar sugestão de título.");
        }
        const dataGerar = await responseGerar.json();
        const tituloSugerido = dataGerar.tituloSugerido.replace(/"/g, "").trim();

        const novoTitulo = prompt("Sugestão de título para a conversa:\n\n" + tituloSugerido + "\n\nVocê pode editar ou confirmar:", tituloSugerido);

        if (novoTitulo === null || novoTitulo.trim() === "") {
            alert("Operação de titulação cancelada ou título vazio.");
            return;
        }

        const responseSalvar = await fetch(`/api/chat/historicos/${sessionId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ titulo: novoTitulo }),
        });

        if (!responseSalvar.ok) {
            const errorData = await responseSalvar.json();
            throw new Error(errorData.error || "Erro ao salvar o título.");
        }

        alert("Título atualizado com sucesso!");
        liElement.querySelector("span").textContent = novoTitulo;

    } catch (error) {
        console.error("Erro ao obter e salvar título:", error);
        alert(`Erro na titulação da conversa: ${error.message}`);
    }
}

async function salvarHistorico(sessionId, botId, messages, userId) {
    try {
        const response = await fetch("/api/chat/salvar-historico", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sessionId, botId, messages, userId }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || "Erro ao salvar histórico no DB.");
        }
        console.log("Histórico salvo com sucesso no DB.");
        localStorage.setItem("currentChatSessionId", sessionId);
        carregarHistoricoSessoes();

    } catch (error) {
        console.error("Erro ao salvar histórico:", error);
    }
}

window.addEventListener("load", () => {
    const NOME_DO_BOT = "Musashi Miyamoto";
    const SLOGAN_DO_BOT = "Seu companheiro inteligente para dúvidas e aprendizado!";
    const DESCRICAO_BOT_PARAGRAFO1 = "Musashi Miyamoto é um bot forjado no espírito do lendário guerreiro samurai. Se procuras os grandes ensinamentos do Caminho da Estratégia, basta falar comigo.";
    const DESCRICAO_BOT_PARAGRAFO2 = "Com a lâmina da sabedoria e o escudo da honra, guiarei tua mente e teu espírito pelos caminhos dos Samurais, até que alcances a verdadeira maestria no Caminho da Espada. Este bot utiliza a poderosa API Gemini para fornecer respostas inteligentes e relevantes.";
    const AUTORES = [
        "Carlos Eduardo",
        "[Nome Aluno 2]",
        "[Nome Aluno 3]"
    ];

    document.getElementById("nome-bot-display").textContent = NOME_DO_BOT;
    document.getElementById("slogan-bot-display").textContent = SLOGAN_DO_BOT;
    document.getElementById("descricao-bot-display").innerHTML = `<p>${DESCRICAO_BOT_PARAGRAFO1}</p><p>${DESCRICAO_BOT_PARAGRAFO2}</p>`;

    const autoriaList = document.querySelector("#autoria-bot ul");
    autoriaList.innerHTML = "";
    AUTORES.forEach(autor => {
        const li = document.createElement("li");
        li.textContent = autor;
        autoriaList.appendChild(li);
    });

    carregarHistoricoSessoes();
});
