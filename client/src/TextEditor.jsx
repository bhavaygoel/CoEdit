import Quill from "quill";
import "quill/dist/quill.snow.css";
import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useLocation, useParams } from "react-router-dom";

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
    const username = location.state?.name || "Anonymous";

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
        const s = io("http://localhost:3001");
        setSocket(s);

        return () => {
            s.disconnect();
        };
    }, []);

    useEffect(() => {
        if (socket == null || quill == null) return;

        // Handler to update user list
        const updateUserListHandler = (users) => {
            setUsers(users);
        };

        // Handler to receive document content and enable editing
        const loadDocumentHandler = (document) => {
            quill.setContents(document);
            quill.enable();
        };

        // Handler to apply received changes
        const receiveChangesHandler = (delta) => {
            quill.updateContents(delta);
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

        // Set up listeners
        socket.emit("get-document", { documentId, username });
        socket.once("load-document", loadDocumentHandler);
        socket.on("update-user-list", updateUserListHandler);
        socket.on("receive-changes", receiveChangesHandler);
        quill.on("text-change", textChangeHandler);
        quill.on("text-change", debouncedSaveHandler);

        // Clean up listeners on unmount
        return () => {
            clearTimeout(timeoutId);
            socket.off("update-user-list", updateUserListHandler);
            socket.off("receive-changes", receiveChangesHandler);
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
            </div>
        </div>
    );
}
