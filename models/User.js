const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  
  // NOVO CAMPO para personalidade customizada
  customSystemInstruction: { 
    type: String, 
    default: null,  // null = usar instrução global do admin
    maxlength: 2000 // Limite de caracteres
  },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
