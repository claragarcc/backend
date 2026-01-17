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
        required: false 
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
   tutorContext: {
        objetivo: String,
        contextoCompleto: String,   
        netlist: String,           
        modoExperto: String,
        ac_refs: [String],         
        version: Number
},

    CA: {
        type: String,
        required: true
    }
});

module.exports = mongoose.model('Ejercicio', ejercicioSchema, 'ejercicios');