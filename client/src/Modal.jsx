import './Modal.css';
import { useState, useRef, useEffect } from 'react';
import Quill from 'quill';
import 'quill/dist/quill.snow.css';

function Modal({ isOpen, onClose, versions, socket, documentId }) {
    const [selectedVersion, setSelectedVersion] = useState(null);
    const quillRef = useRef();

    useEffect(() => {
        if (!isOpen) {
            setSelectedVersion(null);
        }
    }, [isOpen]);

    const wrapperRef = (wrapper) => {
        if (wrapper == null) return;
        wrapper.innerHTML = "";
        const editor = document.createElement("div");
        wrapper.append(editor);
        const q = new Quill(editor, {
            theme: "snow",
            modules: { toolbar: false },
            readOnly: true
        });
        quillRef.current = q;
        if (selectedVersion) {
            q.setContents(selectedVersion.data);
        }
    };

    useEffect(() => {
        if (quillRef.current && selectedVersion) {
            quillRef.current.setContents(selectedVersion.data);
        }
    }, [selectedVersion]);

    if (!isOpen) return null;

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleRestore = () => {
        if (!selectedVersion) return;
        socket.emit("restore-version", {
            documentId: documentId,
            data: selectedVersion.data,
        });
        onClose(); 
    };

    return (
      <div className="modal-overlay" onClick={handleOverlayClick}>
        <div className="modal-content split-view">
          <button className="close-button" onClick={onClose}>
            X
          </button>
          
          <div className="modal-left">
              <h2>Version History</h2>
              <ul className="version-list">
                {versions
                  .slice()
                  .reverse()
                  .map((version, index) => (
                    <li 
                        key={index} 
                        className={selectedVersion === version ? 'selected' : ''}
                        onClick={() => setSelectedVersion(version)}
                    >
                      <p>
                        <strong>Author:</strong> {version.author || "Unknown"}
                      </p>
                      <p>
                        <strong>Time:</strong>{" "}
                        {new Date(version.timestamp).toLocaleString()}
                      </p>
                    </li>
                  ))}
              </ul>
          </div>
          
          <div className="modal-right">
              <h2>Preview</h2>
              <div className="preview-container" ref={wrapperRef}></div>
              {selectedVersion ? (
                  <button className="restore-button" onClick={handleRestore}>
                      Restore This Version
                  </button>
              ) : (
                  <p className="preview-placeholder">Select a version to preview</p>
              )}
          </div>
        </div>
      </div>
    );
}

export default Modal;
