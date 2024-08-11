import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { TransitionGroup, CSSTransition } from 'react-transition-group';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';
import HomePage from './components/HomePage';
import ReelsPage from './components/ReelsPage';
import Direct from './components/Direct';
import WelcomeSetupPage from './components/WelcomeSetupPage';
import SettingsPage from './components/SettingsPage';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';

library.add(fas);

const App = () => {
  const [username, setUsername] = useState('');

  return (
    <div className="bg-gray-900 text-white min-h-screen">
      <Router>
        <TransitionGroup>
          <CSSTransition key={window.location.key} classNames="fade" timeout={300}>
            <Routes>
              <Route path="/welcome" element={
                username ? <WelcomeSetupPage username={username} /> : <Navigate to="/login" replace />
              } />
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage setUsername={setUsername} />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/reels" element={<ReelsPage />} />
              <Route path="/direct" element={<Direct />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </CSSTransition>
        </TransitionGroup>
      </Router>
    </div>
  );
};

export default App;