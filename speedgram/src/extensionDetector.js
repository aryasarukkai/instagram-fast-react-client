// extensionDetector.js
function detectExtension(extensionId, callback) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(extensionId, { message: 'isInstalled' }, response => {
        callback(!!response);
      });
    } else {
      callback(false);
    }
  }
  
  window.detectExtension = detectExtension;