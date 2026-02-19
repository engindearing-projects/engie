import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatPage from './pages/ChatPage';
import MemoryPage from './pages/MemoryPage';
import StatusPage from './pages/StatusPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: 'auto', height: '100vh' }}>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
