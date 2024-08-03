import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInstagram } from '@fortawesome/free-brands-svg-icons';

const ReelsPage = () => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-r from-blue-800 to-pink-900 px-4 sm:px-0">
      <img src="https://speedgram.dev/logo.png" alt="Speedgram Logo" className="mx-auto h-24 mb-8 rounded-lg" />
      <h1 className="text-5xl sm:text-6xl font-bold mb-8 text-white text-center" style={{ fontFamily: 'Georgia' }}>
        Work in Progress
      </h1>
    </div>
  );
};

export default ReelsPage;