const QuillDelta = require('quill-delta');
const CustomDelta = require('./CustomDelta');
const { Mutex } = require('async-mutex');
const Document = require('./Document');
const { transformOp, applyDelta } = require('./OTEngine');
const EventEmitter = require('events');

const MAX_OPS_HISTORY = 1000;

/**
 * In-memory per-document state manager.
 *
 * Each active document is held in memory with:
 *   - content   : the authoritative Quill Delta
 *   - revision  : integer counter, incremented on every applied op
 *   - ops       : recent transformed ops (capped), indexed by revision
 *   - mutex     : per-document lock to serialize op processing
 *   - author    : username of the last person to edit
 *   - saveTimer : debounce timer for auto-saving versions
 */
class DocumentManager extends EventEmitter {
    constructor() {
        super();
        /** @type {Map<string, { content: Delta, revision: number, ops: Array, mutex: Mutex }>} */
        this.documents = new Map();
    }

    /**
     * Load a document into memory (or return existing). Creates in MongoDB if it doesn't exist.
     * @param {string} id – document ID
     * @returns {Promise<{ content: object, revision: number }>}
     */
    async loadDocument(id) {
        if (this.documents.has(id)) {
            const doc = this.documents.get(id);
            return { content: doc.content, revision: doc.revision };
        }

        // Find or create in MongoDB
        let dbDoc = await Document.findById(id);
        if (!dbDoc) {
            dbDoc = await Document.create({ _id: id, data: "", revision: 0 });
        }

        const content = dbDoc.data ? new CustomDelta(dbDoc.data) : new CustomDelta();

        this.documents.set(id, {
            content,
            revision: dbDoc.revision || 0,
            ops: [],
            mutex: new Mutex(),
            author: null,
            saveTimer: null,
        });

        return { content: content, revision: dbDoc.revision || 0 };
    }

    /**
     * Apply a client operation with OT transformation.
     *
     * Acquires the per-document lock, transforms the incoming delta against
     * any operations the client missed, applies it to the server document,
     * and returns the result.
     *
     * @param {string} docId          – document ID
     * @param {number} clientRevision – the revision the client's delta was based on
     * @param {object} delta          – the raw Quill Delta from the client
     * @param {string} author         – username of the author sending the op
     * @returns {Promise<{ transformedDelta: Delta, revision: number }>}
     */
    async applyOperation(docId, clientRevision, delta, author = 'Unknown') {
        const doc = this.documents.get(docId);
        if (!doc) {
            throw new Error(`Document ${docId} not loaded`);
        }

        // Acquire per-document lock — only one op processed at a time
        const release = await doc.mutex.acquire();
        try {
            let transformedDelta;

            if (clientRevision < doc.revision) {
                // Client is behind — transform against all ops it missed
                const missedOps = doc.ops.slice(clientRevision - (doc.revision - doc.ops.length));
                transformedDelta = transformOp(delta, missedOps);
            } else {
                // Client is at HEAD — no transform needed
                transformedDelta = new CustomDelta(delta);
            }

            // Apply to server document
            const newContent = applyDelta(doc.content, transformedDelta);
            doc.content = new CustomDelta(newContent);
            doc.revision++;

            // Store in ops history (capped)
            doc.ops.push(transformedDelta);
            if (doc.ops.length > MAX_OPS_HISTORY) {
                doc.ops.shift();
            }

            // Update author and debounce save
            doc.author = author;
            if (doc.saveTimer) clearTimeout(doc.saveTimer);
            doc.saveTimer = setTimeout(() => {
                this.saveVersion(docId).catch(err => console.error("Error auto-saving version:", err));
            }, 5000); // 5 seconds of idle time triggers version save

            return { transformedDelta, revision: doc.revision };
        } finally {
            release();
        }
    }

    /**
     * Persist the in-memory document state to MongoDB.
     * @param {string} docId
     */
    async saveToDatabase(docId) {
        const doc = this.documents.get(docId);
        if (!doc) return;

        try {
            await Document.findByIdAndUpdate(docId, {
                data: doc.content,
                revision: doc.revision,
            });
        } catch (error) {
            console.error(`Error saving document ${docId} to database:`, error);
        }
    }

    /**
     * Get the current in-memory document state.
     * @param {string} docId
     * @returns {{ content: Delta, revision: number } | null}
     */
    getDocument(docId) {
        return this.documents.get(docId) || null;
    }

    /**
     * Unload a document from memory after saving to database.
     * Call this when the last client disconnects from a document.
     * @param {string} docId
     */
    async unloadDocument(docId) {
        const doc = this.documents.get(docId);
        if (doc && doc.saveTimer) {
            clearTimeout(doc.saveTimer);
        }
        await this.saveToDatabase(docId);
        this.documents.delete(docId);
        console.log(`Document ${docId} unloaded from memory`);
    }

    /**
     * Generate an OT diff to restore a document to a previous state.
     * Instead of a blind overwrite, this creates a clean Delta that can be applied natively.
     * @param {string} docId 
     * @param {object} targetVersionData - The old Quill Delta state
     * @returns {Delta} The necessary reverting operations
     */
    createRestoreOp(docId, targetVersionData) {
        const doc = this.documents.get(docId);
        if (!doc) throw new Error(`Document ${docId} not loaded`);

        // Convert the structural CustomDelta back to QuillDelta explicitly just to calculate diff
        const currentDelta = new QuillDelta(doc.content.ops);
        const targetDelta = new QuillDelta(targetVersionData.ops || targetVersionData);
        // current.diff(target) -> the delta needed to transform current into target
        return currentDelta.diff(targetDelta);
    }

    /**
     * Automatically called by debounce timer 5 seconds after the last edit.
     * Saves a snapshot to the versions array.
     */
    async saveVersion(docId) {
        const doc = this.documents.get(docId);
        if (!doc) return;

        try {
            const dbDoc = await Document.findById(docId);
            if (!dbDoc) return;

            // Don't save if content is identical to last version
            if (dbDoc.versions.length > 0) {
                const lastVersion = dbDoc.versions[dbDoc.versions.length - 1];
                if (JSON.stringify(lastVersion.data) === JSON.stringify(doc.content)) {
                    return; // No changes to save
                }
            }

            const newVersion = { 
                data: doc.content, 
                author: doc.author || 'Unknown', 
                timestamp: new Date() 
            };
            dbDoc.versions.push(newVersion);

            // Retain up to 20 versions
            if (dbDoc.versions.length > 20) {
                dbDoc.versions.shift();
            }

            await dbDoc.save();
            console.log(`Auto-saved version for document ${docId} by ${doc.author}`);
            
            // Emit to server.js so it can broadcast to clients
            this.emit('version-saved', { documentId: docId, versions: dbDoc.versions });
        } catch (error) {
            console.error('Error in saveVersion:', error);
        }
    }
}

module.exports = new DocumentManager();
