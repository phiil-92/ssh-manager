import SshTerminal from "./Terminal.jsx";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">SSH Manager</span>
        <span className="phase-tag">Phase 1</span>
      </header>
      <main className="workspace">
        <SshTerminal />
      </main>
    </div>
  );
}
