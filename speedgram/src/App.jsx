import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { TransitionGroup, CSSTransition } from 'react-transition-group';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';

const App = () => {
  return (
    <div className="bg-gray-900 text-white min-h-screen">
      <Router>
        <TransitionGroup>
          <CSSTransition key={window.location.key} classNames="fade" timeout={300}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </CSSTransition>
        </TransitionGroup>
      </Router>
    </div>
  );
};

export default App;