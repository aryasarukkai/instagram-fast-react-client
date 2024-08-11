import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChromePicker } from 'react-color';
import { loginAndGetSettings, storeUserSettings, initializeDefaultUserSettings } from '../backendInteractions';

const WelcomeSetupPage = ({ username }) => {
  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState(null);
  const [isReturningUser, setIsReturningUser] = useState(false);
  const [theme, setTheme] = useState('solid');
  const [theme1, setTheme1] = useState('#000000');
  const [theme2, setTheme2] = useState('#000000');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState({
    likes: true,
    comments: true,
    follows: true,
    directMessages: true
  });
  const navigate = useNavigate();
  const logoRef = useRef(null);
  const colorPickerRef = useRef(null);

  useEffect(() => {
    const initializeUser = async () => {
      try {
        const { userId, settings, isReturningUser } = await loginAndGetSettings(username, 'password');
        setUserId(userId);
        setIsReturningUser(isReturningUser);
        if (settings) {
          setTheme(settings.theme);
          setTheme1(settings.theme1);
          setTheme2(settings.theme2 || settings.theme1);
          setNotificationPreferences(settings.notificationPreferences);
        } else {
          await initializeDefaultUserSettings(userId, username);
        }
      } catch (error) {
        console.error('Error initializing user:', error);
      }
    };

    initializeUser();
  }, [username]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStep(1);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (step === 1) {
      const timer = setTimeout(() => {
        setStep(2);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [step]);

  useEffect(() => {
    if (step === 4) {
      const timer = setTimeout(() => {
        navigate('/home');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [step, navigate]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target)) {
        setShowColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleThemeSelect = (selectedTheme, colors) => {
    setTheme(colors.length > 1 ? 'gradient' : 'solid');
    setTheme1(colors[0]);
    setTheme2(colors[1] || colors[0]);
  };

  const handleCustomColorChange = (color) => {
    setTheme1(color.hex);
    if (theme === 'gradient') {
      setTheme2(color.hex);
    }
  };

  const handleNotificationChange = (key) => {
    setNotificationPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleConfirm = async () => {
    try {
      const settings = {
        username,
        theme,
        theme1,
        theme2: theme === 'gradient' ? theme2 : undefined,
        notificationPreferences
      };
      await storeUserSettings(userId, settings);
      setStep(prev => prev + 1);
    } catch (error) {
      console.error('Failed to save settings:', error);
      // Handle error (e.g., show error message to user)
    }
  };

  const pageVariants = {
    initial: { opacity: 0 },
    in: { opacity: 1 },
    out: { opacity: 0 }
  };

  const pageTransition = {
    type: 'tween',
    ease: 'anticipate',
    duration: 0.5
  };

  const commonTextStyles = "font-cabin";
  const speedgramTextStyles = `font-georgia text-4xl sm:text-5xl font-bold text-white`;
  const headerTextStyles = `${commonTextStyles} text-4xl sm:text-5xl font-bold mb-8`;

  const getBackgroundStyle = (colors) => {
    if (Array.isArray(colors) && colors.length > 1) {
      return `linear-gradient(to bottom right, ${colors[0]}, ${colors[1]})`;
    }
    return colors[0] || colors;
  };

  const getTextColor = (bgColor) => {
    const rgb = parseInt(bgColor.slice(1), 16);
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = (rgb >> 0) & 0xff;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma > 180 ? 'text-black' : 'text-white';
  };

  const themeOptions = [
    { name: 'Pretty Pink', colors: ['#FFC0CB', '#FF69B4'] },
    { name: 'Inferno Red', colors: ['#FF4500', '#8B0000'] },
    { name: 'Ocean Blue', colors: ['#00BFFF', '#0000CD'] },
    { name: 'Forest Green', colors: ['#228B22', '#006400'] },
    { name: 'Sunset Orange', colors: ['#FF7F50', '#FF4500'] },
    { name: 'Lavender Dream', colors: ['#E6E6FA', '#9370DB'] },
    { name: 'Full Dark', colors: ['#000000'] },
    { name: 'Customize', colors: ['#4B0082', '#9400D3'] }
  ];

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <motion.div
            className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-pink-300 to-pink-500"
          >
            <motion.h1
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={headerTextStyles}
            >
              Welcome to
            </motion.h1>
            <motion.h2
              ref={logoRef}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1, duration: 0.8 }}
              className={speedgramTextStyles}
            >
              speedgram
            </motion.h2>
          </motion.div>
        );
      case 1:
        return (
          <motion.div
            className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-pink-300 to-pink-500"
          >
            <motion.h2
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={`${speedgramTextStyles} absolute bottom-10`}
            >
              speedgram
            </motion.h2>
            <motion.h1
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 0.8 }}
              className={headerTextStyles}
            >
              Let's get setup, {username}
            </motion.h1>
          </motion.div>
        );
      case 2:
        return (
          <motion.div
            className="flex flex-col items-center justify-center h-screen transition-all duration-500 ease-in-out"
            style={{ background: getBackgroundStyle([theme1, theme2]) }}
          >
            <motion.h1
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={`${headerTextStyles} ${getTextColor(theme1)} mb-8`}
            >
              {isReturningUser ? "Welcome back! Update your theme?" : "First, let's pick a theme."}
            </motion.h1>
            <div className="flex flex-wrap justify-center gap-4 max-w-4xl">
              {themeOptions.map(({ name, colors }, index) => (
                <motion.button
                  key={name}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.8 + index * 0.1, duration: 0.5 }}
                  onClick={() => {
                    handleThemeSelect(name, colors);
                    if (name === 'Customize') {
                      setShowColorPicker(true);
                    } else {
                      setShowColorPicker(false);
                    }
                  }}
                  className={`p-4 rounded-lg font-bold ${commonTextStyles} ${
                    theme1 === colors[0] && theme2 === (colors[1] || colors[0]) ? 'ring-2 ring-white' : ''
                  }`}
                  style={{
                    background: getBackgroundStyle(colors),
                    color: getTextColor(colors[0])
                  }}
                >
                  {name}
                </motion.button>
              ))}
            </div>
            {showColorPicker && (
              <motion.div
                ref={colorPickerRef}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="mt-4"
              >
                <ChromePicker
                  color={theme1}
                  onChange={handleCustomColorChange}
                />
                <div className="mt-2 flex items-center justify-center">
                  <label className={`mr-2 ${getTextColor(theme1)}`}>Gradient</label>
                  <input
                    type="checkbox"
                    checked={theme === 'gradient'}
                    onChange={(e) => setTheme(e.target.checked ? 'gradient' : 'solid')}
                  />
                </div>
              </motion.div>
            )}
            <motion.button
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6, duration: 0.5 }}
              onClick={() => setStep(3)}
              className={`mt-8 bg-white text-blue-900 font-bold py-2 px-4 rounded ${commonTextStyles}`}
            >
              Next
            </motion.button>
          </motion.div>
        );
      case 3:
        return (
          <motion.div
            className="flex flex-col items-center justify-center h-screen transition-all duration-500 ease-in-out"
            style={{ background: getBackgroundStyle([theme1, theme2]) }}
          >
            <motion.h1
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={`${headerTextStyles} ${getTextColor(theme1)} mb-8`}
            >
              Set your notification preferences
            </motion.h1>
            <div className="flex flex-col space-y-4">
              {Object.entries(notificationPreferences).map(([key, value]) => (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, x: -50 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8, duration: 0.5 }}
                  className="flex items-center space-x-2"
                >
                  <input
                    type="checkbox"
                    id={key}
                    checked={value}
                    onChange={() => handleNotificationChange(key)}
                    className="form-checkbox h-5 w-5 text-blue-600"
                  />
                  <label htmlFor={key} className={`${commonTextStyles} ${getTextColor(theme1)}`}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </label>
                </motion.div>
              ))}
            </div>
            <motion.button
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.6, duration: 0.5 }}
              onClick={handleConfirm}
              className={`mt-8 bg-white text-blue-900 font-bold py-2 px-4 rounded ${commonTextStyles}`}
            >
              Confirm
            </motion.button>
          </motion.div>
        );
      case 4:
        return (
          <motion.div
            className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-pink-300 to-pink-500"
          >
            <motion.h1
              initial={{ y: -50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
              className={headerTextStyles}
            >
              Welcome to
            </motion.h1>
            <motion.h2
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1, duration: 0.8 }}
              className={speedgramTextStyles}
            >
              speedgram
            </motion.h2>
          </motion.div>
        );
      default:
        return null;
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step}
        initial="initial"
        animate="in"
        exit="out"
        variants={pageVariants}
        transition={pageTransition}
        className="min-h-screen"
      >
        {renderStep()}
      </motion.div>
    </AnimatePresence>
  );
};

export default WelcomeSetupPage;