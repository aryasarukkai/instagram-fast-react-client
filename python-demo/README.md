# Instagram Browser Encryption - Python Demo

This Python implementation demonstrates the same Instagram browser password encryption that's used in the React client.

## 🔐 What This Does

- Implements Instagram's browser password encryption algorithm
- Uses AES-GCM with envelope encryption (same as the JavaScript version)
- Fetches encryption keys from Instagram's shared data endpoint
- Generates properly formatted `#PWD_INSTAGRAM_BROWSER` encrypted passwords

## 📦 Installation

```bash
# Navigate to python-demo directory
cd python-demo

# Install required packages
pip install -r requirements.txt

# Or install individually:
pip install requests cryptography pynacl
```

## 🚀 Usage

### Basic Encryption Test
```bash
python test_encryption.py
```

This will:
1. Fetch encryption keys from Instagram
2. Test password encryption with multiple test passwords
3. Verify the output format is correct

### Full Demo (Educational Only)
```bash
python instagram_demo.py
```

### Using in Your Own Code
```python
from instagram_demo import InstagramBrowserEncryption

# Initialize
instagram = InstagramBrowserEncryption()

# Encrypt a password
encrypted_password = instagram.encrypt_password("your_password")
print(encrypted_password)
# Output: #PWD_INSTAGRAM_BROWSER:10:1704067200:AQJQAIYDctyfXAw...
```

## 🔍 How It Works

1. **Shared Data Fetching**: Gets encryption keys from `https://www.instagram.com/api/v1/web/data/shared_data/`
2. **Key Generation**: Creates a random 256-bit AES key
3. **Envelope Encryption**: 
   - Encrypts the AES key with Instagram's public key using NaCl sealed box
   - Encrypts the password with AES-GCM using the AES key
   - Timestamp is used as additional authenticated data
4. **Format**: Combines everything into Instagram's expected format

## 📁 Files

- `instagram_demo.py` - Main implementation with full login flow
- `test_encryption.py` - Simple test suite for encryption functionality
- `requirements.txt` - Python package dependencies

## ⚠️ Important Notes

### Security & Legal
- **Educational purposes only** - This is for learning about encryption
- **Use test accounts only** - Don't use your main Instagram account
- **Rate limiting** - Instagram has rate limits, don't spam requests
- **Terms of service** - Make sure you comply with Instagram's ToS

### Technical
- Requires Python 3.7+
- Uses the same encryption as Instagram's official web client
- Falls back to plaintext on encryption errors (should be removed in production)
- No session persistence (add as needed)

## 🔗 Related Files

This Python demo implements the same logic as:
- `../speedgram/src/instagramEncryption.js` - JavaScript version
- `../speedgram/src/instagramService.js` - Main service implementation

## 🐛 Troubleshooting

### Common Issues

1. **Import errors**: Make sure all dependencies are installed
   ```bash
   pip install requests cryptography pynacl
   ```

2. **Network errors**: Check your internet connection and firewall

3. **Encryption failures**: Instagram's encryption keys change periodically

4. **Rate limiting**: Wait between requests, don't spam the API

### Debug Mode
Add this to see detailed logs:
```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## 📚 Understanding the Encryption

The encryption process matches Instagram's browser implementation:

```
Password + Timestamp → AES-GCM → Ciphertext + Auth Tag
                  ↓
AES Key → NaCl Sealed Box → Encrypted AES Key
                  ↓
Version + KeyID + EncryptedKey + AuthTag + Ciphertext → Base64 → Final Format
```

Output format: `#PWD_INSTAGRAM_BROWSER:version:timestamp:base64_encrypted_data`

## 🎯 Next Steps

1. Test the encryption with `test_encryption.py`
2. Compare with the JavaScript implementation in the browser
3. Use in your own projects (with proper security considerations)
4. Contribute improvements back to the main project!

## 📄 License

Same as the main project - see LICENSE file.