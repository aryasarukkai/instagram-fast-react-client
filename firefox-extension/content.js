// content.js for Firefox

function injectProxy() {
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (typeof url === 'string' && url.startsWith('https://i.instagram.com/')) {
        url = 'https://i.instagram.com/' + url.split('https://i.instagram.com/')[1];
      }
      return originalXHROpen.call(this, method, url, ...rest);
    };
  
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
      if (typeof url === 'string' && url.startsWith('https://i.instagram.com/')) {
        url = 'https://i.instagram.com/' + url.split('https://i.instagram.com/')[1];
      }
      return originalFetch.call(this, url, options);
    };
  
    // Add an indicator that the extension is active
    window.instagramCorsProxyExtensionActive = true;
    document.documentElement.setAttribute('data-instagram-cors-proxy-active', 'true');
    
    // Firefox-specific: Set up external messaging
    window.addEventListener('message', function(event) {
      if (event.source !== window) return;
      
      if (event.data.type === 'SPEEDGRAM_REQUEST') {
        // Firefox uses browser.runtime instead of chrome.runtime
        const runtime = typeof browser !== 'undefined' ? browser : chrome;
        
        runtime.runtime.sendMessage(event.data.request, function(response) {
          window.postMessage({
            type: 'SPEEDGRAM_RESPONSE',
            id: event.data.id,
            response: response
          }, '*');
        });
      }
    });
  }
  
  // Inject the proxy immediately
  injectProxy();
  
  // Also inject on subsequent navigations
  window.addEventListener('load', injectProxy);