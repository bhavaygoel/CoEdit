import Quill from "quill";
import "quill/dist/quill.snow.css";
import { useCallback, useEffect, useState, useRef } from "react";
import { io } from "socket.io-client";
import { useLocation, useParams } from "react-router-dom";
import Modal from "./Modal";

const VERSION_SAVE_INTERVAL_MS = 1 * 30 * 1000; // 1 minute
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

        // Handler to update the user list
        const updateUserListHandler = (users) => {
            setUsers(users);
        };

        // Handler to receive document content and enable editing
        const loadDocumentHandler = (document) => {
            quill.setContents(document);
            quill.enable();

            lastSavedContent.current = quill.getContents();
        };

        // Handler to apply received changes
        const receiveChangesHandler = (delta) => {
            quill.updateContents(delta);
            lastSavedContent.current = quill.getContents();

        };

        // Handler to send changes made by the current user
        const textChangeHandler = (delta, oldDelta, source) => {
            if (source !== "user") return;
            socket.emit("send-changes", delta);
        };

        // Save document content with debounce
        let timeoutId;
        const saveDocument = () => {
            socket.emit("save-document", quill.getContents());
        };

        const debouncedSaveHandler = () => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(saveDocument, SAVE_DEBOUNCE_MS);
        };


        
        // Handler to update versions when a new version is saved
        const updateVersionHandler = (updatedVersions) => {
            setVersions(updatedVersions);
        };


        const saveVersionInterval = setInterval(() => {
            const currentContent = quill.getContents();
            const lengthDifference = Math.abs(currentContent.length() - lastSavedContent.current.length());

            if (lengthDifference >= 10 || JSON.stringify(currentContent) !== JSON.stringify(lastSavedContent.current)) {
                // Save the document version
                socket.emit("save-version", { documentId, data: currentContent, author: username });
                
                lastSavedContent.current = currentContent;
            }
        }, VERSION_SAVE_INTERVAL_MS);

        const handleRestoredVersion = (data) => {
            console.log("Restoring version", data);
            quill.setContents(data);
            lastSavedContent.current = quill.getContents();
        };

        // Set up listeners
        socket.emit("get-document", { documentId, username });
        socket.once("load-document", loadDocumentHandler);
        socket.on("update-user-list", updateUserListHandler);
        socket.on("receive-changes", receiveChangesHandler);
        socket.on("update-versions", updateVersionHandler);
        socket.on("receive-restored-version", handleRestoredVersion);

        quill.on("text-change", textChangeHandler);
        quill.on("text-change", debouncedSaveHandler);

        // Clean up listeners on unmount
        return () => {
            clearTimeout(timeoutId);
            clearInterval(saveVersionInterval);
            socket.off("update-user-list", updateUserListHandler);
            socket.off("receive-changes", receiveChangesHandler);
            socket.off("update-versions", updateVersionHandler);
            quill.off("text-change", textChangeHandler);
            quill.off("text-change", debouncedSaveHandler);
            socket.off("receive-restored-version", handleRestoredVersion);
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
