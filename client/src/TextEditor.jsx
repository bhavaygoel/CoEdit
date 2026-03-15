import Quill from "quill";
import "quill/dist/quill.snow.css";
import { useCallback, useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { useLocation, useParams } from "react-router-dom";
import Modal from "./Modal";

const Delta = Quill.import("delta");

const SAVE_DEBOUNCE_MS = 500;
const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, 4, 5, 6, false] }],
    [{ font: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["bold", "italic", "underline"],
    [{ color: [] }, { background: [] }],
    [{ script: "sub" }, { script: "super" }],
    [{ align: [] }],
    ["image", "blockquote", "code-block"],
    ["clean"],
];

export default function TextEditor() {
    const { id: documentId } = useParams();
    const location = useLocation();
    const [socket, setSocket] = useState();
    const [quill, setQuill] = useState();
    const [users, setUsers] = useState([]);
    const [versions, setVersions] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const username = location.state?.name || "Anonymous";

    const lastSavedContent = useRef(null);

    const serverRevision = useRef(0);
    const pendingOps = useRef([]);
    const pendingSend = useRef(null);
    const awaitingAck = useRef(false);

    const wrapperRef = useCallback((wrapper) => {
        if (wrapper == null) return;

        wrapper.innerHTML = "";
        const editor = document.createElement("div");
        wrapper.append(editor);

        const q = new Quill(editor, {
            theme: "snow",
            modules: { toolbar: TOOLBAR_OPTIONS },
        });

        q.disable();
        q.setText("Loading...");
        setQuill(q);
    }, []);

    useEffect(() => {
        const s = io("https://coedit-m9zq.onrender.com");
        setSocket(s);

        return () => {
            s.disconnect();
        };
    }, []);

    useEffect(() => {
        if (socket == null || quill == null) return;

        // --- Helpers to flush the pending send buffer ---
        const flushPending = () => {
            if (pendingSend.current && !awaitingAck.current) {
                const delta = pendingSend.current;
                pendingSend.current = null;
                awaitingAck.current = true;
                pendingOps.current.push(delta);
                socket.emit("send-changes", {
                    revision: serverRevision.current,
                    delta,
                    author: username,
                });
            }
        };

        // --- Handler: document loaded from server ---
        const loadDocumentHandler = ({ data, revision }) => {
            quill.setContents(data);
            quill.enable();
            serverRevision.current = revision;
            pendingOps.current = [];
            pendingSend.current = null;
            awaitingAck.current = false;
            lastSavedContent.current = quill.getContents();
        };

        // --- Handler: user list updates ---
        const updateUserListHandler = (users) => {
            setUsers(users);
        };

        // --- Handler: ACK from server (our op was accepted) ---
        const ackHandler = ({ revision }) => {
            serverRevision.current = revision;
            // Remove the oldest pending op (the one that was just ACK'd)
            pendingOps.current.shift();
            awaitingAck.current = false;
            // If there are buffered ops to send, flush them
            flushPending();
        };

        // --- Handler: receive a remote operation ---
        const receiveChangesHandler = ({ delta, revision }) => {
            // Transform all pending (unacknowledged) ops against the incoming remote op
            let incomingDelta = new Delta(delta);

            const transformedPending = [];
            for (const pendingOp of pendingOps.current) {
                const pending = new Delta(pendingOp);
                // Transform the incoming delta against our pending op
                // priority=false → our pending op wins (it was sent first from our perspective)
                const newIncoming = pending.transform(incomingDelta, false);
                // Transform our pending op against the incoming
                // priority=true → the incoming (already applied on server) has priority
                const newPending = incomingDelta.transform(pending, true);
                incomingDelta = newIncoming;
                transformedPending.push(newPending);
            }
            pendingOps.current = transformedPending;

            // Also transform the unsent buffer if any
            if (pendingSend.current) {
                const unsent = new Delta(pendingSend.current);
                const newIncoming = unsent.transform(incomingDelta, false);
                pendingSend.current = incomingDelta.transform(unsent, true);
                incomingDelta = newIncoming;
            }

            // Apply the (possibly transformed) incoming delta to the editor
            quill.updateContents(incomingDelta);
            serverRevision.current = revision;
            lastSavedContent.current = quill.getContents();
        };

        // --- Handler: local text change ---
        const textChangeHandler = (delta, oldDelta, source) => {
            if (source !== "user") return;

            if (!awaitingAck.current) {
                // Nothing in flight — send immediately
                awaitingAck.current = true;
                pendingOps.current.push(delta);
                socket.emit("send-changes", {
                    revision: serverRevision.current,
                    delta,
                    author: username,
                });
            } else {
                // We're waiting for an ACK — buffer the op
                if (pendingSend.current) {
                    // Compose with existing buffer
                    pendingSend.current = new Delta(pendingSend.current).compose(delta);
                } else {
                    pendingSend.current = delta;
                }
            }
        };

        // --- Auto-save debounce ---
        let timeoutId;
        const saveDocument = () => {
            socket.emit("save-document", quill.getContents());
        };
        const debouncedSaveHandler = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(saveDocument, SAVE_DEBOUNCE_MS);
        };

        // --- Version updates ---
        const updateVersionHandler = (updatedVersions) => {
            setVersions(updatedVersions);
        };

        // --- OT error handler ---
        const otErrorHandler = ({ message }) => {
            console.error("OT Error:", message);
        };

        // Set up listeners
        socket.emit("get-document", { documentId, username });
        socket.once("load-document", loadDocumentHandler);
        socket.on("update-user-list", updateUserListHandler);
        socket.on("ack", ackHandler);
        socket.on("receive-changes", receiveChangesHandler);
        socket.on("update-versions", updateVersionHandler);
        socket.on("ot-error", otErrorHandler);

        quill.on("text-change", textChangeHandler);
        quill.on("text-change", debouncedSaveHandler);

        // Clean up listeners on unmount
        return () => {
            clearTimeout(timeoutId);
            socket.off("update-user-list", updateUserListHandler);
            socket.off("ack", ackHandler);
            socket.off("receive-changes", receiveChangesHandler);
            socket.off("update-versions", updateVersionHandler);
            socket.off("ot-error", otErrorHandler);
            quill.off("text-change", textChangeHandler);
            quill.off("text-change", debouncedSaveHandler);
        };
    }, [socket, quill, documentId, username]);

    return (
        <div className="parent">
            <div className="editor-sidebar">
                <h3>Users Online</h3>
                <ul>
                    {users.map((name, index) => (
                        <li key={index}>{name}</li>
                    ))}
                </ul>
            </div>
            <div className="editor-container">
                <div className="container" ref={wrapperRef}></div>
                    <div className="button">
                    <Modal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    versions={versions}
                    socket={socket}
                    documentId={documentId}
                    />
                </div>
                <button className="btn" onClick={() => setIsModalOpen(true)}>
                    <img src="/history-icon.svg" alt="history" className="icon"/>
                    History
                </button>
            </div>
        </div>
    );
}
