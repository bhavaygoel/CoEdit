import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidV4 } from 'uuid';
import './landingPage.css';

function LandingPage() {
    const [name, setName] = useState("");
    const [documentId, setDocumentId] = useState("");
    const navigate = useNavigate();

    const handleJoin = () => {
        if (!name.trim()) {
            alert("Please enter your name");
            return;
        }

        if (!documentId.trim()) {
            alert("Please enter a document ID or create a new document");
            return;
        }

        navigate(`/documents/${documentId}`, { state: { name } });
    };

    const handleCreateNew = () => {
        if (!name.trim()) {
            alert("Please enter your name");
            return;
        }

        const newDocumentId = uuidV4();
        navigate(`/documents/${newDocumentId}`, { state: { name } });
    };

    return (
        <div className="landing-page">
            <div className="form-container">
                <h2>Welcome to Co-Edit!</h2>
                <div>
                    <label>Name:</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter your name"
                    />
                </div>
                <div>
                    <label>Document ID:</label>
                    <input
                        type="text"
                        value={documentId}
                        onChange={(e) => setDocumentId(e.target.value)}
                        placeholder="Enter document ID"
                    />
                </div>
                <button onClick={handleJoin}>Join Document</button>
                <p className="create-new">
                    Want to create a new document?{" "}
                    <span onClick={handleCreateNew} className="create-link">Click here</span>
                </p>
            </div>
        </div>
    );
}

export default LandingPage;
