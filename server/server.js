const mongoose = require('mongoose');
const Document = require('./Document');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const connectedUsers = {};

mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Connected to MongoDB");
}).catch((error) => {
    console.error("Error connecting to MongoDB:", error);
});

const io = require('socket.io')(PORT, {
    cors: {
        origin: "*", // Allow any origin
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {

    socket.on('get-document', async ({ documentId, username }) => {
        socket.join(documentId);

        handleUserConnection(socket, documentId, username);
        
        const document = await findOrCreateDocument(documentId);

        socket.emit('load-document', document.data);
        socket.emit('update-versions', document.versions);

        setupDocumentListeners(socket, documentId);
    });

    socket.on('save-version', async ({ documentId, data, author }) => {
        await saveVersion(documentId, data, author);
    });

    socket.on("restore-version", ({ documentId, data }) => {
        io.to(documentId).emit("receive-restored-version", data);

        // Save the restored version
        Document.findByIdAndUpdate(documentId, { data: data });
    });

    socket.on('disconnect', () => {
        handleUserDisconnection(socket);
    });
});

function handleUserConnection(socket, documentId, username) {
    if (!connectedUsers[documentId]) {
        connectedUsers[documentId] = {};
    }

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

            io.to(documentId).emit('update-user-list', Object.values(connectedUsers[documentId]));

            if (Object.keys(connectedUsers[documentId]).length === 0) {
                delete connectedUsers[documentId];
            }
            break;
        }
    }
}

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

async function saveVersion(documentId, newData, author) {
    try {
        const document = await Document.findById(documentId);
        if (!document) throw new Error('Document not found');
        if(JSON.stringify(document.versions[document.versions.length - 1].data) === JSON.stringify(newData)) {
            console.log("this is same data");
            return;
        }
        const newVersion = { data: newData, author, timestamp: new Date() };
        document.versions.push(newVersion);

        // Limit the versions to the last 10
        if (document.versions.length > 10) {
            document.versions.shift(); // Remove the oldest version
        }

        await document.save();
        io.to(documentId).emit('update-versions', document.versions);

    } catch (error) {
        console.error('Error saving version:', error);
    }
}
