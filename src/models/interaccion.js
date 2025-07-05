const mongoose = require('mongoose');

// Definición del esquema para cada mensaje individual dentro de la conversación
const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        required: true,
        // Los roles son 'user' (para mensajes del usuario) o 'assistant' (para mensajes del tutor)
        enum: ['user', 'assistant'],
        default: 'user'
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });


// Definición del esquema principal para una Interacción completa entre usuario y tutor
const interaccionSchema = mongoose.Schema({
    usuario_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    ejercicio_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ejercicio',
        required: true
    },
    inicio: {
        type: Date,
        required: true,
        default: Date.now
    },
    fin: {
        type: Date,
        default: Date.now // Establece la fecha actual por defecto, se actualizará
    },
    conversacion: {
        type: [messageSchema], // Este es el campo clave: un array de mensajes
        default: []
    }
});

module.exports = mongoose.model("Interaccion", interaccionSchema);