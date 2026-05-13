import { useState } from 'react';
import SpectralPersistence from './spectral_persistence';
import SpectralDemo from './spectral_roundtrip_demo';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('demo');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '16px',
        background: '#0a0a0a',
        borderBottom: '1px solid #1a1a1a',
        gap: '16px'
      }}>
        <button
          onClick={() => setActiveTab('demo')}
          style={{
            padding: '10px 24px',
            background: activeTab === 'demo' ? '#2A2A2A' : 'transparent',
            border: '1px solid #2A2A2A',
            color: activeTab === 'demo' ? '#E8E4DD' : '#888',
            borderRadius: '6px',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            transition: 'all 0.2s ease'
          }}
        >
          Live Demo
        </button>
        <button
          onClick={() => setActiveTab('theory')}
          style={{
            padding: '10px 24px',
            background: activeTab === 'theory' ? '#2A2A2A' : 'transparent',
            border: '1px solid #2A2A2A',
            color: activeTab === 'theory' ? '#E8E4DD' : '#888',
            borderRadius: '6px',
            cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '13px',
            transition: 'all 0.2s ease'
          }}
        >
          Theory & Economics
        </button>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        {activeTab === 'demo' ? <SpectralDemo /> : <SpectralPersistence />}
      </div>
    </div>
  );
}

export default App;
