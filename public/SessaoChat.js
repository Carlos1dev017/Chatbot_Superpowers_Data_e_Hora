import mongoose from 'mongoose';

const sessaoChatSchema = new mongoose.Schema({
    sessionId: String,
    botId: String,
    startTime: Date,
    endTime: Date,
    messages: Array, // Array de objetos
    loggedAt: Date,
    titulo: { type: String, default: 'Conversa Sem Título', trim: true },
    userId: { type: String, required: true } // Adicionado para a B3.P1.A4
}, { strict: false }); // strict: false permite campos não definidos no schema

const SessaoChat = mongoose.model('SessaoChat', sessaoChatSchema, 'sessoesChat'); // O 3º argumento força o nome da coleção

export default SessaoChat;
