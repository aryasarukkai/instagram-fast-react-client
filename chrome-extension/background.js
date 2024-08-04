chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    if (request.action === 'makeRequest') {
      fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.data
      })
      .then(async response => {
        const data = await response.text();
        const headers = {};
        for (let [key, value] of response.headers) {
          headers[key] = value;
        }
        sendResponse({
          status: response.status,
          data: data,
          headers: headers
        });
      })
      .catch(error => {
        sendResponse({error: error.message});
      });
      return true; // Indicates that we will send a response asynchronously
    }
  });
  