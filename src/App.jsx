import { useState } from 'react';
import InfWaveStudio from './components/InfWaveStudio';
import SpectralPersistence from './spectral_persistence';
import SpectralDemo from './spectral_roundtrip_demo';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState('studio');

  if (activeTab === 'studio') {
    return <InfWaveStudio onSwitchView={setActiveTab} />;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Compact Top Navigation for Classic / Economics views */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '12px 16px',
        background: '#171a20',
        borderBottom: '1px solid #2a303b',
        gap: '10px',
        flexWrap: 'wrap'
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12px',
          letterSpacing: '2px',
          color: '#38d47a',
          marginRight: '8px',
          fontWeight: 700
        }}>
          INFWAVE
        </span>
        {[
          ['studio', '← Timeline Studio'],
          ['demo', 'Classic Roundtrip'],
          ['theory', 'Theory & Economics'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              padding: '6px 14px',
              background: activeTab === id ? '#1d2129' : 'transparent',
              border: `1px solid ${activeTab === id ? '#38d47a88' : '#2a303b'}`,
              color: activeTab === id ? '#38d47a' : '#8490a3',
              borderRadius: '4px',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              transition: 'all 0.15s ease'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1 }}>
        {activeTab === 'demo' ? <SpectralDemo /> : <SpectralPersistence />}
      </div>
    </div>
  );
}

export default App;
