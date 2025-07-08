import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';
import InstagramBrowserEncryption from './instagramEncryption.js';

import { Buffer } from 'buffer/';

const API_URL = 'https://www.instagram.com/api/v1/web/';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

let session = null;
let csrfToken = null;
let cookies = '';

const generateUUID = () => uuidv4().replace(/-/g, '');

const generateDeviceId = () => {
  return 'android-' + CryptoJS.MD5(Math.random().toString()).toString().substring(0, 16);
};
async function sendMessageToExtension(message) {
  return new Promise((resolve, reject) => {
    // Check if extension is available
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('Extension not available'));
      return;
    }
    
    // Try to detect the extension ID dynamically or use a default
    const extensionId = window.instagramExtensionId || 'njdidabcneoijpjohimfnbjmkbilppnb';
    
    chrome.runtime.sendMessage(extensionId, message, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

async function createPayload(data) {
  return sendMessageToExtension({
    action: 'createPayload',
    data: data
  });
}

async function fetchCsrfToken() {
  const response = await sendMessageToExtension({
    action: 'makeRequest',
    method: 'GET',
    url: 'https://www.instagram.com/',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    }
  });

  console.log('Full response:', response);

  // Extract CSRF token from HTML response
  const htmlContent = response.data;
  const csrfMatch = htmlContent.match(/"csrf_token":"([^"]+)"/);
  if (csrfMatch && csrfMatch[1]) {
    csrfToken = csrfMatch[1];
  } else {
    console.error('CSRF token not found in HTML response');
    throw new Error('Failed to extract CSRF token from response');
  }

  // Extract cookies from response headers
  if (response.responseHeaders && response.responseHeaders['set-cookie']) {
    cookies = response.responseHeaders['set-cookie'].join('; ');
  }

  console.log('CSRF Token:', csrfToken);
  console.log('Cookies:', cookies);
}

export const login = async (username, password) => {
  try {
    await fetchCsrfToken();

    // Initialize browser encryption
    const encryption = new InstagramBrowserEncryption();
    
    // Encrypt the password using browser encryption
    const encryptedPassword = await encryption.encryptPassword(password);
    
    console.log('Using encrypted password:', encryptedPassword);

    const uuid = generateUUID();
    const requestUUID = generateUUID();

    // Create the login payload for web browser
    const loginData = {
      enc_password: encryptedPassword,
      username: username,
      queryParams: '{}',
      optIntoOneTap: false,
      requestUUID: requestUUID,
      _csrftoken: csrfToken
    };

    // Convert to form data
    const formData = new URLSearchParams();
    Object.keys(loginData).forEach(key => {
      formData.append(key, loginData[key]);
    });

    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}accounts/login/ajax/`,
      data: formData.toString(),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrfToken,
        'X-Instagram-AJAX': '1',
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': '0',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/',
        'Cookie': cookies,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Ch-UA': '"Google Chrome";v="91", "Chromium";v="91", ";Not A Brand";v="99"',
        'Sec-Ch-UA-Mobile': '?0',
        'Sec-Ch-UA-Platform': '"Windows"'
      }
    });

    console.log('Login response:', response);

    if (response.status === 200) {
      const responseData = JSON.parse(response.data);
      
      if (responseData.authenticated) {
        // Extract session information
        session = {
          userId: responseData.userId,
          sessionId: responseData.sessionid,
          csrfToken: csrfToken,
          cookies: cookies,
          authenticated: true
        };

        // Save session to browser storage
        try {
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ 'igSession': session }, function() {
              console.log('Session saved to browser storage');
            });
          } else {
            // Fallback to localStorage
            localStorage.setItem('igSession', JSON.stringify(session));
            localStorage.setItem('isLoggedIn', 'true');
            console.log('Session saved to localStorage');
          }
        } catch (error) {
          console.error('Failed to save session:', error);
        }

        return { success: true, session: session };
      } else {
        return { success: false, message: responseData.message || 'Login failed' };
      }
    } else {
      const errorData = JSON.parse(response.data);
      return { success: false, message: errorData.message || 'Login failed' };
    }
  } catch (error) {
    console.error("An error occurred during login:", error);
    return { success: false, message: error.message || 'An unknown error occurred' };
  }
};

// Helper functions
function generateJazoest(input) {
  let buf = Buffer.from(input, 'utf8');
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i];
  }
  return `2${sum}`;
}


export const deserializeSession = (sessionData) => {
  session = sessionData;
};

export const getFeed = async () => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}feed/timeline/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-CSRFToken': session.csrfToken,
        'X-Instagram-AJAX': '1',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.instagram.com/',
        'Cookie': session.cookies
      }
    });

    return JSON.parse(response.data);
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const getUserInfo = async (username) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}users/${username}/usernameinfo/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const getDirectMessages = async () => {
  if (!session) {
    throw new Error('Not logged in');
  }

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'GET',
      url: `${API_URL}direct_v2/inbox/`,
      headers: {
        'User-Agent': USER_AGENT,
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const sendDirectMessage = async (recipientId, message) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  const data = {
    recipient_users: `[[${recipientId}]]`,
    client_context: uuidv4(),
    thread_ids: [],
    text: message
  };

  const payload = await createPayload(data);

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}direct_v2/threads/broadcast/text/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

export const updateProfile = async (profileData) => {
  if (!session) {
    throw new Error('Not logged in');
  }

  const payload = await createPayload(profileData);

  try {
    const response = await sendMessageToExtension({
      action: 'makeRequest',
      method: 'POST',
      url: `${API_URL}accounts/edit_profile/`,
      data: payload,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${session.token}`,
        'X-CSRFToken': csrfToken,
        'Cookie': cookies
      }
    });

    return response.data;
  } catch (error) {
    console.error("An error occurred:", error);
    throw error;
  }
};

// Add more functions as needed