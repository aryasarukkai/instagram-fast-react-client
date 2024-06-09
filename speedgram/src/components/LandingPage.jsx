import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInstagram } from '@fortawesome/free-brands-svg-icons';

const LandingPage = () => {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-r from-black to-red-900 px-4 sm:px-0">
      <img src="https://speedgram.dev/logo.png" alt="Speedgram Logo" className="mx-auto h-24 mb-8 rounded-lg" />
      <h1 className="text-5xl sm:text-6xl font-bold mb-8 text-white text-center" style={{ fontFamily: 'Georgia' }}>
        speedgram
      </h1>
      <Link
        to="/login"
        className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded flex items-center mx-4 sm:mx-0"
      >
        <FontAwesomeIcon icon={faInstagram} className="mr-2" />
        Log In with Instagram
      </Link>
    </div>
  );
};

export default LandingPage;