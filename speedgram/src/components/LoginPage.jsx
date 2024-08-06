import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Notyf } from 'notyf';
import 'notyf/notyf.min.css';
import { isLoggedIn } from '../utils';
import { Lock } from 'lucide-react';
import { login } from '../instagramService';

const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPopup, setShowPopup] = useState(false);
  const navigate = useNavigate();

  const notyf = new Notyf();

  useEffect(() => {
    if (isLoggedIn()) {
      navigate('/home');
    }
  }, [navigate]);

  const handleLogin = async () => {
    setShowPopup(true);
  };

  const confirmLogin = async () => {
    setShowPopup(false);
    try {
      console.log('Attempting login...');
      const loginResult = await login(username, password);
      console.log('Login result:', loginResult);
      
      if (loginResult.success) {
        notyf.success('Login successful! Redirecting...');
        navigate('/home');
      } else {
        notyf.error(loginResult.message || 'Login failed');
      }
    } catch (error) {
      console.error('Login failed:', error);
      notyf.error('An unknown error occurred. Please try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-r from-black to-red-900 px-4 sm:px-0">
      <img src="https://speedgram.dev/logo.png" alt="Speedgram Logo" className="mx-auto h-24 mb-8 rounded-lg" />
      <h1 className="text-4xl sm:text-5xl font-bold mb-8 text-white text-center" style={{ fontFamily: 'Georgia' }}>
        speedgram
      </h1>
      <div className="bg-gradient-to-r from-blue-900 to-black p-8 rounded shadow-md mx-4 sm:mx-0">
        <h2 className="text-xl sm:text-2xl font-bold mb-1 text-white text-center" style={{ fontFamily: 'Cabin' }}>
          Login with Instagram
        </h2>
        <div className="flex items-center justify-center mb-1 text-gray-300 text-sm">
          <Lock size={16} className="mr-1" />
          <span>This information is securely submitted directly to Instagram.</span>
        </div>
        <div className="flex items-center justify-center mb-6 text-gray-300 text-sm">
          <span><a href="https://speedgram.dev/security" target="_blank">Click Here to Learn More</a></span>
        </div>
        <input
          type="text"
          placeholder="Instagram Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full mb-4 p-2 bg-gray-700 rounded text-white"
          style={{ fontFamily: 'Cabin' }}
        />
        <input
          type="password"
          placeholder="Instagram Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-8 p-2 bg-gray-700 rounded text-white"
          style={{ fontFamily: 'Cabin' }}
        />
        <div className="flex flex-col sm:flex-row items-center justify-between">
          <button
            onClick={handleLogin}
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded mb-4 sm:mb-0"
            style={{ fontFamily: 'Cabin' }}
          >
            Login
          </button>
          <a
            href="https://www.instagram.com/accounts/emailsignup/"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded mb-4 sm:mb-0 sm:ml-4"
            style={{ fontFamily: 'Cabin' }}
          >
            Register via Instagram
          </a>
          <Link
            to="/"
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded mb-4 sm:mb-0 sm:ml-4"
            style={{ fontFamily: 'Cabin' }}
          >
            ⬅️ Back
          </Link>
        </div>
      </div>

      {/* Popup Modal */}
      {showPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-black rounded-lg p-8 max-w-md w-full transform transition-all duration-300 ease-in-out scale-90 opacity-0 animate-popup">
            <h3 className="text-2xl font-bold mb-4 text-white">Important Information</h3>
            <p className="mb-6 text-white">
              Speedgram cannot access any information that is sent directly to Instagram. This includes passwords, post interactions, messages, and more. However, your activity on Instagram through Speedgram is simulated as a Samsung mobile device in order to enable access to features that the web version cannot generally access, like themes in messages, music notes, vanish mode, and more. <strong><a href="https://github.com/aryasarukkai/instagram-fast-react-client/blob/main/Devices.md">Click here to learn more.</a></strong>
            </p>
            <div className="flex justify-end">
              <button
                onClick={confirmLogin}
                className="bg-blue-900 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
              >
                Proceed with Login
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginPage;