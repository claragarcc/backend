const mongoose = require ('mongoose');

const userSchema = mongoose.Schema({
    loguin_usuario: {
        type: String,
        required: true
    }

});

module.exports = mongoose.model('Usuario', userSchema);