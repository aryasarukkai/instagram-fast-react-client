<div align="center">
  <img src="landing/logo.png" alt="Speedgram Logo" width="250" height="250" />
  <h1>⚡ Speedgram ⚡</h1>
  <p>The lightning-fast Instagram client for web and desktop, powered by React ⚛️</p>
</div>

## 🚀 Features

- ✨ Beautiful, intuitive UI
- 🏎️ Blazing fast performance
- 💬 IGMessenger support for direct messaging
- 🖥️ Available on web and as a desktop app
- 🧠 Smart caching for optimal speed
- 🔋 Efficient resource usage for longer battery life on laptops
- 🌐 Can be self-hosted and self-built

## 🔐 New: Instagram Browser Encryption

**Major Update**: Now includes proper Instagram browser password encryption!

- ✅ **AES-GCM Encryption**: Implements Instagram's actual browser encryption algorithm
- 🔑 **Envelope Encryption**: Uses Web Crypto API with NaCl sealed box encryption
- 🌐 **Browser Format**: Generates proper `#PWD_INSTAGRAM_BROWSER` formatted passwords
- 🐍 **Python Demo**: Complete Python implementation for testing and validation
- 🦊 **Firefox Support**: Cross-browser extension compatibility

## ‼️ Current Issues

- ~~Unable to interact directly with Instagram API endpoints due to CORS policies~~ [[Resolved using a Chrome Extension, which will be bundled with Electron Desktop application and mobile application.]](https://github.com/aryasarukkai/instagram-fast-react-client/issues/1)
- ~~API Requests are being refused with error `{"message":"Your version of Instagram is out of date. Please upgrade your app to log in to Instagram.","status":"fail","error_type":"needs_upgrade"}`~~ **[RESOLVED]** - Now uses proper browser encryption and web API endpoints

## 🌐 Web App

Speedgram is available as a pre-built web app at [web.speedgram.dev](https://web.speedgram.dev). No installation required!

## 📦 Self-Hosting and Building

For detailed instructions on self-hosting and building Speedgram, please refer to our wiki at [wiki.speedgram.dev](https://wiki.speedgram.dev).

## 📁 Project Structure

```
├── speedgram/              # Main React application
│   ├── src/
│   │   ├── instagramEncryption.js  # Browser encryption implementation
│   │   ├── instagramService.js     # Instagram API service
│   │   └── components/             # React components
├── chrome-extension/       # Chrome/Chromium extension
├── firefox-extension/      # Firefox extension
├── python-demo/           # Python encryption demo
│   ├── instagram_demo.py  # Full Python implementation
│   ├── test_encryption.py # Test suite
│   └── README.md          # Python demo documentation
└── CLAUDE.md              # Development status and technical notes
```

## 🛣️ Roadmap

Speedgram is currently a work in progress. Here's what we're working on:

- [x] Create web interface
- [x] Create a browser extension for Chrome, Firefox, and Safari that enable CORS interactions.
- [x] **NEW**: Implement proper Instagram browser password encryption
- [x] **NEW**: Add Python demo for encryption testing
- [ ] Create a bundled Desktop and Mobile distribution that contain a self-regulated CORS proxy.
- [ ] Fetch and display posts
- [ ] Handle like and comment interactions
- [ ] Implement Instagram DM/direct
- [ ] Handle sharing
- [ ] Implement reels
- [ ] More to-do items TBD

## 🤝 Contributing

We are actively accepting contributions! 🎉

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 💖 Open-Source References

We are utilizing API endpoints that have been taken right off <a href="https://github.com/subzeroid/instagrapi">subzeroid/instagrapi</a> and we adapted them to JS. It is a supporting pillar for this project, so huge thanks to them!

## ✨ Contributors

- [Arya Sarukkai // @aryasarukkai](https://github.com/aryasarukkai)
- [Daniel Yeh // @GoodMusic8596](https://github.com/GoodMusic8596)

## 📄 License

This project is licensed under the terms of the GNU General Public License v3.0. See `LICENSE` for more information.

## 🤑 Sponsors

- [@fishalook](https://x.com/fishalook)

## 💬 Contact

Arya Sarukkai - [dev@imarya.lol](mailto:dev@imarya.lol) 

Project Link: [https://github.com/aryasarukkai/instagram-fast-react-client](https://github.com/aryasarukkai/instagram-fast-react-client)

Made with ❤️ by Arya Sarukkai and Daniel Yeh
