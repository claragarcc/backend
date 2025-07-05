const mongoose = require ('mongoose');

const ejercicioSchema = mongoose.Schema({
    titulo: {
        type: String,
        required: true
    },
    enunciado: {
        type: String,
        required: true
    },
    imagen: {
        type: String,
        required: false // Es mejor que no sea obligatorio
    }, 
    asignatura: {
        type: String,
        required: true
    },
    concepto: {
        type: String,
        required: true
    },
    nivel: {
        type: Number,
        required: true
    },
    contextoTutor: {
        type: String,
        required: false
    },
    CA: {
        type: String,
        required: true
    }
});

// --- CORRECCIÓN CLAVE AQUÍ ---
// Añadimos el tercer parámetro ('ejercicios') para decirle a Mongoose el nombre exacto de la colección.
// Si en MongoDB Compass tu colección se llama diferente, cámbialo aquí.
module.exports = mongoose.model('Ejercicio', ejercicioSchema, 'ejercicios');