const mongoose = require('mongoose');
const Document = require('./Document');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const connectedUsers = {}; // Track connected users by document ID

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => {
    console.log("Connected to MongoDB");
}).catch((error) => {
    console.error("Error connecting to MongoDB:", error);
});

// Initialize Socket.io Server
const io = require('socket.io')(PORT, {
    cors: {
        origin: "*", // Allow any origin
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log("New client connected:", socket.id);

    // Handle document joining
    socket.on('get-document', async ({ documentId, username }) => {
        socket.join(documentId);

        // Update and broadcast the user list
        handleUserConnection(socket, documentId, username);
        
        // Load document data and send to the client
        const document = await findOrCreateDocument(documentId);
        socket.emit('load-document', document.data);

        // Setup listeners for document editing and saving
        setupDocumentListeners(socket, documentId);
    });

    // Handle client disconnect
    socket.on('disconnect', () => {
        handleUserDisconnection(socket);
    });
});

// Function to handle user connection and update the user list
function handleUserConnection(socket, documentId, username) {
    if (!connectedUsers[documentId]) {
        connectedUsers[documentId] = {};
    }

    // Avoid duplicate entries for the same user in the same document
    const isUserAlreadyConnected = Object.values(connectedUsers[documentId]).includes(username);
    if (!isUserAlreadyConnected) {
        connectedUsers[documentId][socket.id] = username;
        io.to(documentId).emit('update-user-list', Object.values(connectedUsers[documentId]));
    }
}

// Function to handle user disconnection and update the user list
function handleUserDisconnection(socket) {
    for (const documentId in connectedUsers) {
        if (connectedUsers[documentId][socket.id]) {
            delete connectedUsers[documentId][socket.id];

            // Update the user list in the document room
            io.to(documentId).emit('update-user-list', Object.values(connectedUsers[documentId]));

            // If no users left in the document room, remove the entry
            if (Object.keys(connectedUsers[documentId]).length === 0) {
                delete connectedUsers[documentId];
            }
            break;
        }
    }
}

// Function to set up listeners for document changes and saving
function setupDocumentListeners(socket, documentId) {
    socket.on('send-changes', (delta) => {
        socket.broadcast.to(documentId).emit('receive-changes', delta);
    });

    socket.on('save-document', async (data) => {
        try {
            await Document.findByIdAndUpdate(documentId, { data });
        } catch (error) {
            console.error("Error saving document:", error);
        }
    });
}

// Function to find or create a document in MongoDB
async function findOrCreateDocument(id) {
    if (id == null) return;

    try {
        const document = await Document.findById(id);
        return document || await Document.create({ _id: id, data: "" });
    } catch (error) {
        console.error("Error finding or creating document:", error);
        throw error;
    }
}
