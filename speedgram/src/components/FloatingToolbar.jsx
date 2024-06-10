import React from 'react';
import { Link } from 'react-router-dom';

const FloatingToolbar = () => {
  return (
    <div className="w-full flex justify-center mt-4">
      <div className="bg-gray-800 rounded-full px-8 py-2 flex items-center space-x-4 shadow-2xl">
      <img src="https://speedgram.dev/logo.png" alt="Speedgram Logo" className="h-8" />
        <nav className="flex space-x-4">
        
        <Link to="/home" className="text-white">Home</Link>
          <Link to="/reels" className="text-white">Reels</Link>
          <Link to="/messages" className="text-white">Messages</Link>
          <Link to="/profile" className="text-white">Profile</Link>
          <Link to="/search" className="text-white">Search</Link>
          <Link to="/settings" className="text-white">Settings</Link>
        </nav>
      </div>
    </div>
  );
};

export default FloatingToolbar;