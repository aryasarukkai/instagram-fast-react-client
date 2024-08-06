import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInstagram } from '@fortawesome/free-brands-svg-icons';
import Cookies from 'js-cookie';

const LandingPage = () => {
  const [showExtensionPopup, setShowExtensionPopup] = useState(false);
  const [showBetaPopup, setShowBetaPopup] = useState(true);

  useEffect(() => {
    const extensionAcknowledged = Cookies.get('extensionAcknowledged');
    if (!extensionAcknowledged) {
      setShowExtensionPopup(true);
    }
  }, []);

  const handleInstall = () => {
    window.open('https://chrome.google.com/webstore/detail/ext-id', '_blank');
  };

  const handleAlreadyInstalled = () => {
    Cookies.set('extensionAcknowledged', 'true', { expires: 365 }); // Cookie expires in 1 year
    setShowExtensionPopup(false);s
  };

  const handleBetaAcknowledgment = () => {
    setShowBetaPopup(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-r from-blue-800 to-pink-900 px-4 sm:px-0">
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

      {showBetaPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-black rounded-lg p-8 max-w-md w-full transform transition-all duration-300 ease-in-out scale-90 opacity-0 animate-popup">
            <h3 className="text-2xl font-bold mb-4 text-white">Beta Release Warning</h3>
            <p className="mb-6 text-white">
              This is a beta release of Speedgram. By using this version, you acknowledge and agree to the following:
              <ul className="list-disc list-inside mt-2">
              <li><strong>EXPECT MISSING FEATURES</strong> - We are open to suggestions in case we miss anything, but until the app is out of beta, many features are being developed and are not ready.</li>
                <li>There may be bugs that could potentially affect your Instagram account.</li>
                <li>We cannot guarantee the security or stability of the application.</li>
                <li>You use Speedgram at your own risk, and we are not liable for any issues that may arise.</li>
                <li>Before using the beta, consider that a worst case scenario (your Instagram password gets leaked and your account gets locked for spam) could happen.  If you are okay with these risks, continue.</li>
                <li>This project is in active development.  You can view <a href="https://speedgram.dev/repo">our soruce code on GitHub (click)</a> and any feedback is appreciated.</li>
              </ul>
            </p>
            <div className="flex justify-end">
              <button
                onClick={handleBetaAcknowledgment}
                className="bg-blue-900 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
              >
                I Understand and Agree
              </button>
            </div>
          </div>
        </div>
      )}

      {showExtensionPopup && !showBetaPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-black rounded-lg p-8 max-w-md w-full transform transition-all duration-300 ease-in-out scale-90 opacity-0 animate-popup">
            <h3 className="text-2xl font-bold mb-4 text-white">Extension Required</h3>
            <p className="mb-6 text-white">
              To use Speedgram on web, you need to install our Chrome extension. <strong><a href="https://github.com/aryasarukkai/instagram-fast-react-client/releases/latest">If you do not want to install an extension, you can use the Speedgram App (click)</a></strong> This extension acts as a local CORS proxy for Instagram API interactions, enabling access to features that the web version cannot generally access.
            </p>
            <div className="flex justify-end space-x-4">
              <button
                onClick={handleAlreadyInstalled}
                className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded"
              >
                I've Already Installed
              </button>
              <button
                onClick={handleInstall}
                className="bg-blue-900 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded"
              >
                Install Extension
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;