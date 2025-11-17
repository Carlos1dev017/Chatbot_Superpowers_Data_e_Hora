// public/perfil.js
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('custom-instruction-textarea');
    const saveButton = document.getElementById('save-personality-btn');
    const statusMessage = document.getElementById('status-message');

    // Pega o token de autenticação do armazenamento local
    const token = localStorage.getItem('authToken');

    // Se não houver token, o usuário não está logado. Bloqueia a página.
    if (!token) {
        document.body.innerHTML = '<h1>Acesso Negado. <a href="/login.html">Por favor, faça login primeiro.</a></h1>';
        return;
    }

    // 1. Função para carregar a preferência atual do usuário do backend
    async function loadUserPreference() {
        try {
            const response = await fetch('/api/user/preferences', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                throw new Error('Não foi possível carregar sua configuração.');
            }

            const data = await response.json();
            textarea.value = data.customSystemInstruction; // Preenche o campo de texto com a config salva

        } catch (error) {
            showStatus(error.message, 'error');
        }
    }

    // 2. Função para salvar a nova preferência no backend
    async function saveUserPreference() {
        const customInstruction = textarea.value;
        showStatus('Salvando...', 'loading'); // Feedback visual

        try {
            const response = await fetch('/api/user/preferences', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ customInstruction })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Erro desconhecido ao salvar.');
            }

            showStatus(result.message, 'success');

        } catch (error) {
            showStatus(error.message, 'error');
        }
    }
    
    // Função para exibir mensagens de feedback para o usuário
    function showStatus(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
    }

    // Adiciona o evento de clique ao botão de salvar
    saveButton.addEventListener('click', saveUserPreference);

    // Carrega a configuração do usuário assim que a página é aberta
    loadUserPreference();
});
