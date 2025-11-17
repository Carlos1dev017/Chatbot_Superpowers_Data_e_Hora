app.get('/api/user/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId; // Vem do middleware de autenticação
    
    const user = await User.findById(userId).select('customSystemInstruction');
    
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json({
      customSystemInstruction: user.customSystemInstruction || null
    });
    
  } catch (error) {
    console.error('Erro ao buscar preferências:', error);
    res.status(500).json({ error: 'Erro ao buscar preferências' });
  }
});

// PUT - Atualizar preferências do usuário
app.put('/api/user/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.userId;
    const { customSystemInstruction } = req.body;
    
    // Validação básica
    if (customSystemInstruction && customSystemInstruction.length > 2000) {
      return res.status(400).json({ 
        error: 'Instrução muito longa (máximo 2000 caracteres)' 
      });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { customSystemInstruction: customSystemInstruction || null },
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    res.json({
      success: true,
      message: 'Personalidade salva com sucesso!',
      customSystemInstruction: updatedUser.customSystemInstruction
    });
    
  } catch (error) {
    console.error('Erro ao atualizar preferências:', error);
    res.status(500).json({ error: 'Erro ao salvar preferências' });
  }
});

// ============================================
// ROTA DE CHAT COM PERSONALIDADE ADAPTATIVA
// ============================================

app.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.userId;
    
    if (!message) {
      return res.status(400).json({ error: 'Mensagem não fornecida' });
    }
    
    // ============================================
    // LÓGICA DE DECISÃO: Personalidade do Usuário ou Global?
    // ============================================
    
    // 1. Buscar o usuário completo
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // 2. Buscar a configuração global do admin
    const adminConfig = await AdminConfig.findOne();
    const globalInstruction = adminConfig?.systemInstruction || 
      'Você é um assistente prestativo.'; // Fallback padrão
    
    // 3. DECISÃO INTELIGENTE: Priorizar personalidade do usuário
    const systemInstruction = user.customSystemInstruction || globalInstruction;
    
    console.log(`[Chat] Usuário: ${user.username}`);
    console.log(`[Chat] Usando instrução: ${user.customSystemInstruction ? 'PERSONALIZADA' : 'GLOBAL'}`);
    
    // 4. Buscar ou criar o histórico de chat
    let chatHistory = await ChatHistory.findOne({ userId });
    
    if (!chatHistory) {
      chatHistory = new ChatHistory({
        userId,
        messages: []
      });
    }
    
    // 5. Preparar o histórico para o Gemini
    const formattedHistory = chatHistory.messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.text }]
    }));
    
    // 6. Inicializar o modelo com a instrução CORRETA
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: systemInstruction, // Instrução personalizada ou global
      tools: tools // Suas ferramentas (getCurrentTime, etc)
    });
    
    // 7. Iniciar o chat com o histórico
    const chat = model.startChat({
      history: formattedHistory
    });
    
    // 8. Enviar a mensagem do usuário
    let result = await chat.sendMessage(message);
    let response = result.response;
    
    // 9. Processar Function Calling (se houver)
    while (response.functionCalls && response.functionCalls.length > 0) {
      const functionCall = response.functionCalls[0];
      const functionName = functionCall.name;
      const functionArgs = functionCall.args || {};
      
      if (availableFunctions[functionName]) {
        const functionResult = availableFunctions[functionName](functionArgs);
        
        result = await chat.sendMessage([{
          functionResponse: {
            name: functionName,
            response: functionResult
          }
        }]);
        
        response = result.response;
      } else {
        break;
      }
    }
    
    // 10. Extrair a resposta final
    const botReply = response.text();
    
    // 11. Salvar no histórico
    chatHistory.messages.push({ role: 'user', text: message });
    chatHistory.messages.push({ role: 'model', text: botReply });
    await chatHistory.save();
    
    // 12. Retornar a resposta
    res.json({ reply: botReply });
    
  } catch (error) {
    console.error('Erro no chat:', error);
    res.status(500).json({ error: 'Erro ao processar mensagem' });
  }
});