import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: [true, 'O nome de usuário é obrigatório.'],
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: [true, 'A senha é obrigatória.'],
    },
    customSystemInstruction: {
        type: String,
        trim: true
    }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;
