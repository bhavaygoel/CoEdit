const mongoose = require('mongoose');
const Document = require('./Document');
const documentManager = require('./DocumentManager');
require('dotenv').config();

const PORT = process.env.PORT || 3001;
const connectedUsers = {};

// Track how many sockets are in each document room
const roomClientCount = {};

mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("Connected to MongoDB");
}).catch((error) => {
    console.error("Error connecting to MongoDB:", error);
});

const io = require('socket.io')(PORT, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Periodic flush of in-memory documents to MongoDB (every 30 seconds)
const FLUSH_INTERVAL_MS = 30 * 1000;
setInterval(() => {
    for (const docId of documentManager.documents.keys()) {
        documentManager.saveToDatabase(docId).catch(err => {
            console.error(`Periodic flush failed for ${docId}:`, err);
        });
    }
}, FLUSH_INTERVAL_MS);

// Listen to DocumentManager's background version saves
documentManager.on('version-saved', ({ documentId, versions }) => {
    io.to(documentId).emit('update-versions', versions);
});

io.on('connection', (socket) => {

    socket.on('get-document', async ({ documentId, username }) => {
        socket.join(documentId);

        // Track room membership
        roomClientCount[documentId] = (roomClientCount[documentId] || 0) + 1;
        // Store documentId on socket for cleanup on disconnect
        socket.documentId = documentId;

        handleUserConnection(socket, documentId, username);

        // Load document into memory (or retrieve existing)
        const { content, revision } = await documentManager.loadDocument(documentId);

        // Fetch versions from MongoDB for the version history UI
        const dbDoc = await Document.findById(documentId);
        const versions = dbDoc ? dbDoc.versions : [];

        // Send document content AND revision to client
        socket.emit('load-document', { data: content, revision });
        socket.emit('update-versions', versions);

        setupDocumentListeners(socket, documentId);
    });

    socket.on("restore-version", async ({ documentId, data }) => {
        try {
            // Compute the diff from HEAD to the target historical version
            const diff = documentManager.createRestoreOp(documentId, data);
            
            // If there's no difference, do nothing
            if (!diff || diff.ops.length === 0) return;

            // Treat the revert as a normal edit submitted by the server at the current HEAD
            const doc = documentManager.getDocument(documentId);
            const currentRevision = doc ? doc.revision : 0;
            
            const result = await documentManager.applyOperation(documentId, currentRevision, diff, "System (Restore)");

            // Broadcast the revert to all clients so they seamlessly jump back
            // without losing any of their pending operations (since it's a standard OT operation)
            io.to(documentId).emit("receive-changes", {
                delta: result.transformedDelta,
                revision: result.revision,
            });
        } catch (error) {
            console.error("Error restoring version:", error);
        }
    });

    socket.on('disconnect', () => {
        const docId = socket.documentId;
        handleUserDisconnection(socket);

        // Decrement room count, unload if last client
        if (docId && roomClientCount[docId]) {
            roomClientCount[docId]--;
            if (roomClientCount[docId] <= 0) {
                delete roomClientCount[docId];
                documentManager.unloadDocument(docId).catch(err => {
                    console.error(`Failed to unload document ${docId}:`, err);
                });
            }
        }
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
    // ---- OT-aware change handling ----
    socket.on('send-changes', async ({ revision, delta, author }) => {
        try {
            const result = await documentManager.applyOperation(documentId, revision, delta, author);

            // ACK the sender with the new server revision
            socket.emit('ack', { revision: result.revision });

            // Broadcast the transformed delta + new revision to all other clients
            socket.broadcast.to(documentId).emit('receive-changes', {
                delta: result.transformedDelta,
                revision: result.revision,
            });
        } catch (error) {
            console.error('Error applying OT operation:', error);
            socket.emit('ot-error', { message: 'Failed to apply operation' });
        }
    });

    // Periodic save (client triggers this for auto-save)
    socket.on('save-document', async () => {
        try {
            await documentManager.saveToDatabase(documentId);
        } catch (error) {
            console.error("Error saving document:", error);
        }
    });
}
