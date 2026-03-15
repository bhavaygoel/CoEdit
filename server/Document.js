const { Schema, model } = require('mongoose');

const Version = new Schema({
    data: Object,
    timestamp: { type: Date, default: Date.now },
    author: String
})

const Document = new Schema({
    _id: String,
    data: Object,
    revision: { type: Number, default: 0 },
    versions: {
        type: [Version],
        default: []
    }
});

module.exports = model('Document', Document);