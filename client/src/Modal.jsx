import './Modal.css'; // Styling for the modal

function Modal({ isOpen, onClose, versions, socket, documentId }) {
    if (!isOpen) return null;

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    // Restore a specific version
    const handleRestore = (version) => {
        socket.emit("restore-version", {
            documentId: documentId,
            data: version.data,
        });
        onClose(); 
    };
    return (
      <div className="modal-overlay" onClick={handleOverlayClick}>
        <div className="modal-content">
          <h2>Version History</h2>
          <button className="close-button" onClick={onClose}>
            X
          </button>
          <ul className="version-list">
            {versions
              .slice()
              .reverse()
              .map((version, index) => (
                <li key={index}>
                  <p>
                    <strong>Author:</strong> {version.author || "Unknown"}
                  </p>
                  <p>
                    <strong>Timestamp:</strong>{" "}
                    {new Date(version.timestamp).toLocaleString()}
                  </p>
                  <button
                    className="restore-button"
                    onClick={() => handleRestore(version)}
                  >
                    Restore
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>
    );
}

export default Modal;
