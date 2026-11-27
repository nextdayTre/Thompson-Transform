import { useState } from 'react';
import InfWaveStudio from './components/InfWaveStudio';
import SpectralPersistence from './spectral_persistence';
import SpectralDemo from './spectral_roundtrip_demo';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('studio');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '16px',
        background: '#0a0a0a',
        borderBottom: '1px solid #1a1a1a',
        gap: '12px',
        flexWrap: 'wrap'
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
          letterSpacing: '2px',
          color: '#4AF28A',
          marginRight: '8px',
          fontWeight: 600
        }}>
          INFWAVE
        </span>
        {[
          ['studio', 'InfWave Studio'],
          ['demo', 'Classic Roundtrip'],
          ['theory', 'Theory & Economics'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: '9px 20px',
              background: activeTab === id ? '#2A2A2A' : 'transparent',
              border: `1px solid ${activeTab === id ? '#4AF28A55' : '#2A2A2A'}`,
              color: activeTab === id ? '#E8E4DD' : '#888',
              borderRadius: '6px',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '12px',
              transition: 'all 0.2s ease'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        {activeTab === 'studio' ? (
          <InfWaveStudio />
        ) : activeTab === 'demo' ? (
          <SpectralDemo />
        ) : (
          <SpectralPersistence />
        )}
      </div>
    </div>
  );
}

export default App;
