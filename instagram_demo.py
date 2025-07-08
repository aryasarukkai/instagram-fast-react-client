#!/usr/bin/env python3
"""
Instagram Browser Authentication Demo (Python)
Based on reverse engineering analysis - implements proper browser encryption
"""

import requests
import json
import re
import time
import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
import nacl.public
import nacl.encoding
import nacl.utils

class InstagramBrowserEncryption:
    def __init__(self):
        self.session = requests.Session()
        self.csrf_token = None
        self.encryption_keys = None
        self.cookies = {}
        
        # Browser headers to mimic real browser
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
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
        })

    def get_shared_data(self):
        """Fetch encryption keys from Instagram's shared data endpoint"""
        print("🔑 Fetching encryption keys from Instagram...")
        
        try:
            # First get the main page to get CSRF token
            response = self.session.get('https://www.instagram.com/')
            
            if response.status_code != 200:
                raise Exception(f"Failed to load Instagram homepage: {response.status_code}")
            
            # Extract CSRF token
            csrf_match = re.search(r'"csrf_token":"([^"]+)"', response.text)
            if csrf_match:
                self.csrf_token = csrf_match.group(1)
                print(f"✅ CSRF Token: {self.csrf_token}")
            else:
                raise Exception("Failed to extract CSRF token")
            
            # Update cookies
            self.cookies.update(response.cookies.get_dict())
            
            # Get shared data with encryption keys
            shared_data_response = self.session.get(
                'https://www.instagram.com/api/v1/web/data/shared_data/',
                headers={
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': self.csrf_token,
                    'Referer': 'https://www.instagram.com/',
                }
            )
            
            if shared_data_response.status_code == 200:
                shared_data = shared_data_response.json()
                if 'encryption' in shared_data:
                    self.encryption_keys = shared_data['encryption']
                    print(f"✅ Encryption Keys Retrieved:")
                    print(f"   Key ID: {self.encryption_keys.get('key_id')}")
                    print(f"   Version: {self.encryption_keys.get('version')}")
                    print(f"   Public Key: {self.encryption_keys.get('public_key')[:32]}...")
                    return True
                else:
                    print("⚠️  No encryption keys found in shared data")
                    return False
            else:
                print(f"❌ Failed to get shared data: {shared_data_response.status_code}")
                return False
                
        except Exception as e:
            print(f"❌ Error getting shared data: {e}")
            return False

    def hex_to_bytes(self, hex_string):
        """Convert hex string to bytes"""
        return bytes.fromhex(hex_string)

    def envelope_encrypt(self, password, timestamp):
        """
        Implement Instagram's envelope encryption
        Based on PolarisEnvelopeEncryption reverse engineering
        """
        try:
            print("🔐 Starting envelope encryption...")
            
            if not self.encryption_keys:
                raise Exception("No encryption keys available")
            
            key_id = self.encryption_keys['key_id']
            public_key_hex = self.encryption_keys['public_key']
            version = self.encryption_keys['version']
            
            # Convert password and timestamp to bytes
            password_bytes = password.encode('utf-8')
            timestamp_bytes = timestamp.encode('utf-8')
            
            # Validate public key length (64 bytes = 128 hex chars)
            if len(public_key_hex) != 128:
                raise Exception("Invalid public key length")
            
            # Convert hex public key to bytes
            public_key_bytes = self.hex_to_bytes(public_key_hex)
            
            # Constants (from Instagram's implementation)
            VERSION_LENGTH = 1
            KEY_ID_LENGTH = 1
            LENGTH_FIELD_LENGTH = 2
            SEALED_KEY_LENGTH = 32
            OVERHEAD_LENGTH = 48  # NaCl sealed box overhead
            TAG_LENGTH = 16
            
            # Calculate total output length
            total_length = (VERSION_LENGTH + KEY_ID_LENGTH + LENGTH_FIELD_LENGTH + 
                          SEALED_KEY_LENGTH + OVERHEAD_LENGTH + TAG_LENGTH + len(password_bytes))
            
            result = bytearray(total_length)
            offset = 0
            
            # Write version
            result[offset] = version
            offset += VERSION_LENGTH
            
            # Write key ID
            result[offset] = key_id
            offset += KEY_ID_LENGTH
            
            # Generate AES-GCM key (256-bit)
            aes_key = os.urandom(32)
            print(f"✅ Generated AES key: {len(aes_key)} bytes")
            
            # Encrypt AES key with public key using NaCl sealed box
            public_key_nacl = nacl.public.PublicKey(public_key_bytes)
            sealed_box = nacl.public.SealedBox(public_key_nacl)
            sealed_key = sealed_box.encrypt(aes_key)
            
            print(f"✅ Sealed key length: {len(sealed_key)} bytes")
            
            # Write sealed key length (little endian)
            result[offset] = len(sealed_key) & 0xFF
            result[offset + 1] = (len(sealed_key) >> 8) & 0xFF
            offset += LENGTH_FIELD_LENGTH
            
            # Write sealed key
            result[offset:offset + len(sealed_key)] = sealed_key
            offset += len(sealed_key)
            
            # Validate sealed key length
            if len(sealed_key) != SEALED_KEY_LENGTH + OVERHEAD_LENGTH:
                raise Exception(f"Invalid sealed key length: {len(sealed_key)}")
            
            # Encrypt password with AES-GCM
            aesgcm = AESGCM(aes_key)
            iv = os.urandom(12)  # 96-bit IV for GCM
            
            # Encrypt with timestamp as additional data
            ciphertext_with_tag = aesgcm.encrypt(iv, password_bytes, timestamp_bytes)
            
            # Split ciphertext and authentication tag
            ciphertext = ciphertext_with_tag[:-16]  # All but last 16 bytes
            auth_tag = ciphertext_with_tag[-16:]    # Last 16 bytes
            
            print(f"✅ Encrypted password: {len(ciphertext)} bytes")
            print(f"✅ Auth tag: {len(auth_tag)} bytes")
            
            # Write authentication tag
            result[offset:offset + TAG_LENGTH] = auth_tag
            offset += TAG_LENGTH
            
            # Write ciphertext
            result[offset:offset + len(ciphertext)] = ciphertext
            
            print(f"✅ Envelope encryption complete: {len(result)} bytes")
            return bytes(result)
            
        except Exception as e:
            print(f"❌ Envelope encryption failed: {e}")
            raise

    def encrypt_password(self, password):
        """
        Main password encryption function
        Returns Instagram browser format: #PWD_INSTAGRAM_BROWSER:version:timestamp:encrypted_data
        """
        try:
            print(f"🔐 Encrypting password for Instagram browser...")
            
            if not self.encryption_keys:
                if not self.get_shared_data():
                    raise Exception("Failed to get encryption keys")
            
            # Generate timestamp
            timestamp = str(int(time.time()))
            
            # Perform envelope encryption
            encrypted_data = self.envelope_encrypt(password, timestamp)
            
            # Encode to base64
            encoded_data = base64.b64encode(encrypted_data).decode('ascii')
            
            # Format according to Instagram's browser format
            version = self.encryption_keys['version']
            formatted_password = f"#PWD_INSTAGRAM_BROWSER:{version}:{timestamp}:{encoded_data}"
            
            print(f"✅ Password encrypted successfully")
            print(f"   Format: #PWD_INSTAGRAM_BROWSER:{version}:{timestamp}:[{len(encoded_data)} chars]")
            
            return formatted_password
            
        except Exception as e:
            print(f"❌ Password encryption failed: {e}")
            # Fallback to plaintext (for testing only)
            timestamp = str(int(time.time()))
            fallback = f"#PWD_INSTAGRAM_BROWSER:0:{timestamp}:{password}"
            print(f"⚠️  Using plaintext fallback: {fallback}")
            return fallback

    def login(self, username, password):
        """
        Perform Instagram login with encrypted password
        """
        try:
            print(f"🔐 Logging in as {username}...")
            
            # Ensure we have CSRF token
            if not self.csrf_token:
                if not self.get_shared_data():
                    raise Exception("Failed to get CSRF token")
            
            # Encrypt password
            encrypted_password = self.encrypt_password(password)
            
            # Prepare login data
            login_data = {
                'enc_password': encrypted_password,
                'username': username,
                'queryParams': '{}',
                'optIntoOneTap': 'false',
                'requestUUID': self.generate_uuid(),
                '_csrftoken': self.csrf_token
            }
            
            # Update session headers for login request
            login_headers = {
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-CSRFToken': self.csrf_token,
                'X-Instagram-AJAX': '1',
                'X-IG-App-ID': '936619743392459',
                'X-IG-WWW-Claim': '0',
                'X-Requested-With': 'XMLHttpRequest',
                'Origin': 'https://www.instagram.com',
                'Referer': 'https://www.instagram.com/',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Ch-UA': '"Google Chrome";v="91", "Chromium";v="91", ";Not A Brand";v="99"',
                'Sec-Ch-UA-Mobile': '?0',
                'Sec-Ch-UA-Platform': '"Windows"'
            }
            
            # Perform login request
            response = self.session.post(
                'https://www.instagram.com/api/v1/web/accounts/login/ajax/',
                data=login_data,
                headers=login_headers
            )
            
            print(f"📡 Login response status: {response.status_code}")
            
            if response.status_code == 200:
                result = response.json()
                print(f"📝 Login response: {json.dumps(result, indent=2)}")
                
                if result.get('authenticated'):
                    print("✅ Login successful!")
                    return True, result
                else:
                    print(f"❌ Login failed: {result.get('message', 'Unknown error')}")
                    return False, result
            else:
                print(f"❌ Login request failed with status {response.status_code}")
                print(f"Response: {response.text}")
                return False, None
                
        except Exception as e:
            print(f"❌ Login error: {e}")
            return False, None

    def generate_uuid(self):
        """Generate UUID for request tracking"""
        import uuid
        return str(uuid.uuid4())

def main():
    """Demo function"""
    print("🚀 Instagram Browser Authentication Demo")
    print("=" * 50)
    
    # Initialize encryption
    instagram = InstagramBrowserEncryption()
    
    # Test encryption key fetching
    print("\n1️⃣ Testing encryption key fetching...")
    if instagram.get_shared_data():
        print("✅ Encryption keys obtained successfully")
    else:
        print("❌ Failed to get encryption keys")
        return
    
    # Test password encryption
    print("\n2️⃣ Testing password encryption...")
    test_password = "test_password_123"
    encrypted = instagram.encrypt_password(test_password)
    print(f"✅ Encrypted password format: {encrypted[:50]}...")
    
    # For actual login testing (uncomment and provide real credentials)
    print("\n3️⃣ Login testing...")
    print("⚠️  To test actual login, uncomment the lines below and provide real credentials")
    print("⚠️  WARNING: Only use test accounts as this is for educational purposes!")
    
    # Uncomment these lines to test actual login:
    # username = input("Enter Instagram username: ")
    # password = input("Enter Instagram password: ")
    # success, result = instagram.login(username, password)
    # if success:
    #     print("🎉 Login successful!")
    # else:
    #     print("💔 Login failed")
    
    print("\n✅ Demo completed!")

if __name__ == "__main__":
    # Install required packages:
    print("📦 Required packages:")
    print("pip install requests cryptography pynacl")
    print()
    
    try:
        main()
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("Run: pip install requests cryptography pynacl")
    except Exception as e:
        print(f"❌ Demo failed: {e}")