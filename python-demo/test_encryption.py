#!/usr/bin/env python3
"""
Simple test script to verify Instagram encryption implementation
"""

from instagram_demo import InstagramBrowserEncryption
import sys

def test_encryption():
    """Test the encryption functionality"""
    print("🧪 Testing Instagram Browser Encryption")
    print("=" * 40)
    
    try:
        # Initialize
        instagram = InstagramBrowserEncryption()
        
        # Test 1: Get shared data
        print("\n1️⃣ Testing shared data retrieval...")
        if instagram.get_shared_data():
            print("✅ Shared data retrieved successfully")
            print(f"   Key ID: {instagram.encryption_keys.get('key_id')}")
            print(f"   Version: {instagram.encryption_keys.get('version')}")
        else:
            print("❌ Failed to retrieve shared data")
            return False
        
        # Test 2: Test password encryption
        print("\n2️⃣ Testing password encryption...")
        test_passwords = ["test123", "mypassword", "complex_pass_123!"]
        
        for password in test_passwords:
            try:
                encrypted = instagram.encrypt_password(password)
                if encrypted.startswith("#PWD_INSTAGRAM_BROWSER:"):
                    print(f"✅ '{password}' -> {encrypted[:60]}...")
                else:
                    print(f"❌ Invalid format for '{password}'")
                    return False
            except Exception as e:
                print(f"❌ Encryption failed for '{password}': {e}")
                return False
        
        print("\n✅ All encryption tests passed!")
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

def demo_login():
    """Demo login flow (without actual credentials)"""
    print("\n🔐 Demo Login Flow")
    print("=" * 20)
    
    instagram = InstagramBrowserEncryption()
    
    # Demo credentials (won't actually work)
    demo_username = "demo_user"
    demo_password = "demo_password"
    
    print(f"📝 Demo login with: {demo_username}")
    
    # This will fail at the actual login but will show the encryption process
    success, result = instagram.login(demo_username, demo_password)
    
    if not success:
        print("⚠️  Login failed as expected (demo credentials)")
        print("💡 To test with real credentials, edit the script")
    
    return True

if __name__ == "__main__":
    print("Instagram Browser Encryption Test Suite")
    print("=" * 50)
    
    # Run tests
    if test_encryption():
        print("\n" + "=" * 50)
        demo_login()
        print("\n🎉 All tests completed!")
        print("\n💡 Next steps:")
        print("   1. Install browser extension")
        print("   2. Test with real credentials (use test account)")
        print("   3. Check browser console for detailed logs")
    else:
        print("\n💔 Tests failed!")
        sys.exit(1)