import TextEditor from "./TextEditor"
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate
} from "react-router-dom"
import { v4 as uuidV4 } from "uuid"
import LandingPage from "./LandingPage"

function App() {
  return (
    <Router>
      <Routes>
        <Route 
          path="/" 
          element={<LandingPage />} 
        />
        <Route 
          path="/documents/:id" 
          element={<TextEditor />} 
        />
      </Routes>
    </Router>
  )
}

export default App