import axios from 'axios';

const API_BASE_URL = 'https://speedgram-server-307cabcac2e6.herokuapp.com';

// Helper function to handle API errors
const handleApiError = (error) => {
  if (error.response) {
    console.error('API Error:', error.response.data);
    throw new Error(error.response.data.error || 'An error occurred while communicating with the server');
  } else if (error.request) {
    console.error('No response received:', error.request);
    throw new Error('No response received from the server');
  } else {
    console.error('Error:', error.message);
    throw new Error('An error occurred while setting up the request');
  }
};

// Function to handle user login and retrieve settings
export const loginAndGetSettings = async (username, password) => {
  try {
    // Simulated login for development purposes
    // In a real scenario, you would make an API call to authenticate the user
    const userId = 'simulated_user_id'; // This should come from your authentication system

    // After successful login, retrieve user settings
    const response = await axios.get(`${API_BASE_URL}/settings/${userId}`);
    
    return {
      userId: userId,
      settings: response.data.settings,
      isReturningUser: response.data.isReturningUser
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // User settings not found, treat as new user
      return {
        userId: 'simulated_user_id',
        settings: null,
        isReturningUser: false
      };
    }
    handleApiError(error);
  }
};

// Function to store user settings
export const storeUserSettings = async (userId, settings) => {
  try {
    // Validate the settings object before sending it
    if (!settings.username || !settings.theme || !settings.theme1 ||
        (settings.theme === 'gradient' && !settings.theme2) ||
        !settings.notificationPreferences) {
      throw new Error('Invalid settings format');
    }

    if (settings.theme !== 'solid' && settings.theme !== 'gradient') {
      throw new Error('Invalid theme option');
    }

    const response = await axios.post(`${API_BASE_URL}/settings/${userId}`, settings);
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
};

// Function to retrieve user settings
export const getUserSettings = async (userId) => {
  try {
    const response = await axios.get(`${API_BASE_URL}/settings/${userId}`);
    return response.data;
  } catch (error) {
    handleApiError(error);
  }
};

// Function to update user theme
export const updateUserTheme = async (userId, theme) => {
  try {
    const currentSettings = await getUserSettings(userId);
    const updatedSettings = { ...currentSettings.settings, theme };
    const response = await storeUserSettings(userId, updatedSettings);
    return response;
  } catch (error) {
    handleApiError(error);
  }
};

// Function to update notification preferences
export const updateNotificationPreferences = async (userId, notificationPreferences) => {
  try {
    const currentSettings = await getUserSettings(userId);
    const updatedSettings = { ...currentSettings.settings, notificationPreferences };
    const response = await storeUserSettings(userId, updatedSettings);
    return response;
  } catch (error) {
    handleApiError(error);
  }
};

// Function to initialize default user settings
export const initializeDefaultUserSettings = async (userId, username) => {
  const defaultSettings = {
    username,
    theme: 'solid',
    theme1: '#000000',
    notificationPreferences: {
      likes: true,
      comments: true,
      follows: true,
      directMessages: true
    }
  };

  try {
    const response = await storeUserSettings(userId, defaultSettings);
    return response;
  } catch (error) {
    handleApiError(error);
  }
};
