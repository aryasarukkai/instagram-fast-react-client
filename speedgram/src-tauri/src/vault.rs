use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;
use rand::RngCore;
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;

const KEYRING_SERVICE: &str = "dev.speedgram.desktop";
const KEYRING_ACCOUNT: &str = "vault-key";
const CLIENT_NAME: &[u8] = b"speedgram";
const SESSION_RECORD: &[u8] = b"instagram-session";
const DEVICE_RECORD: &[u8] = b"instagram-device-profile";
const CREDENTIALS_RECORD: &[u8] = b"instagram-credentials";
const WEB_SESSION_RECORD: &[u8] = b"instagram-web-session";

pub struct SecretVault {
    inner: Mutex<Stronghold>,
}

impl SecretVault {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let snapshot_path = data_dir.join("speedgram.hold");
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
            .map_err(|_| "macOS Keychain is unavailable.".to_owned())?;

        let encoded = match entry.get_password() {
            Ok(existing) => existing,
            Err(_) if !snapshot_path.exists() => {
                let mut key = [0_u8; 32];
                rand::rng().fill_bytes(&mut key);
                let encoded = STANDARD.encode(key);
                entry.set_password(&encoded).map_err(|_| {
                    "The vault key could not be saved to macOS Keychain.".to_owned()
                })?;
                encoded
            }
            Err(_) => {
                return Err("The SpeedGram vault exists, but its Keychain key is missing.".into())
            }
        };
        let key = STANDARD
            .decode(encoded)
            .map_err(|_| "The SpeedGram vault key is invalid.".to_owned())?;
        Self::from_parts(snapshot_path, key)
    }

    fn from_parts(path: PathBuf, key: Vec<u8>) -> Result<Self, String> {
        let stronghold = Stronghold::new(path, key)
            .map_err(|_| "The encrypted SpeedGram vault could not be opened.".to_owned())?;
        // `Stronghold::new` loads the snapshot file, but the client must be pulled
        // out of it with `load_client` before its records are reachable. Only when
        // that fails (a brand-new vault) do we create a fresh client — otherwise we
        // would overwrite the existing snapshot with an empty client on every launch.
        if stronghold.load_client(CLIENT_NAME).is_err() {
            stronghold.create_client(CLIENT_NAME).map_err(|_| {
                "The encrypted SpeedGram vault could not be initialized.".to_owned()
            })?;
            stronghold
                .save()
                .map_err(|_| "The encrypted SpeedGram vault could not be saved.".to_owned())?;
        }
        Ok(Self {
            inner: Mutex::new(stronghold),
        })
    }

    pub fn load_bundle(&self) -> Result<Option<Value>, String> {
        let stronghold = self
            .inner
            .lock()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let bytes = client
            .store()
            .get(SESSION_RECORD)
            .map_err(|_| "The saved Instagram session could not be read.".to_owned())?;
        bytes
            .map(|value| {
                serde_json::from_slice(&value)
                    .map_err(|_| "The saved Instagram session is invalid.".to_owned())
            })
            .transpose()
    }

    pub fn save_bundle(&self, bundle: &Value) -> Result<(), String> {
        self.save_record(SESSION_RECORD, bundle)
    }

    pub fn load_device_bundle(&self) -> Result<Option<Value>, String> {
        self.load_record(DEVICE_RECORD)
    }

    pub fn save_device_bundle(&self, bundle: &Value) -> Result<(), String> {
        self.save_record(DEVICE_RECORD, bundle)
    }

    /// The user's raw Instagram credentials, captured in SpeedGram's own UI so a
    /// single sign-in can autofill the web login and later mint the mobile
    /// session. Encrypted at rest by Stronghold; never leaves this process.
    pub fn load_credentials(&self) -> Result<Option<Value>, String> {
        self.load_record(CREDENTIALS_RECORD)
    }

    pub fn save_credentials(&self, bundle: &Value) -> Result<(), String> {
        self.save_record(CREDENTIALS_RECORD, bundle)
    }

    /// Cookies captured from the embedded Instagram web login. This is the
    /// browser-minted session that powers the core (web) feature set.
    pub fn load_web_session(&self) -> Result<Option<Value>, String> {
        self.load_record(WEB_SESSION_RECORD)
    }

    pub fn save_web_session(&self, bundle: &Value) -> Result<(), String> {
        self.save_record(WEB_SESSION_RECORD, bundle)
    }

    pub fn clear_web_session(&self) -> Result<(), String> {
        let stronghold = self
            .inner
            .lock()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let _ = client.store().delete(WEB_SESSION_RECORD);
        stronghold
            .save()
            .map_err(|_| "The encrypted SpeedGram vault could not be saved.".to_owned())
    }

    fn load_record(&self, record: &[u8]) -> Result<Option<Value>, String> {
        let stronghold = self
            .inner
            .lock()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let bytes = client
            .store()
            .get(record)
            .map_err(|_| "The saved Instagram device profile could not be read.".to_owned())?;
        bytes
            .map(|value| {
                serde_json::from_slice(&value)
                    .map_err(|_| "The saved Instagram device profile is invalid.".to_owned())
            })
            .transpose()
    }

    fn save_record(&self, record: &[u8], bundle: &Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(bundle)
            .map_err(|_| "The Instagram session could not be encrypted.".to_owned())?;
        let stronghold = self
            .inner
            .lock()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        client
            .store()
            .insert(record.to_vec(), bytes, None)
            .map_err(|_| "The Instagram session could not be encrypted.".to_owned())?;
        stronghold
            .save()
            .map_err(|_| "The encrypted SpeedGram vault could not be saved.".to_owned())
    }

    pub fn clear_bundle(&self) -> Result<(), String> {
        let stronghold = self
            .inner
            .lock()
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .map_err(|_| "Secure storage is unavailable.".to_owned())?;
        let _ = client.store().delete(SESSION_RECORD);
        let _ = client.store().delete(DEVICE_RECORD);
        let _ = client.store().delete(CREDENTIALS_RECORD);
        let _ = client.store().delete(WEB_SESSION_RECORD);
        stronghold
            .save()
            .map_err(|_| "The encrypted SpeedGram vault could not be saved.".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn vault_round_trip_and_logout_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let vault = SecretVault::from_parts(temp.path().join("test.hold"), vec![7; 32]).unwrap();
        assert!(vault.load_bundle().unwrap().is_none());
        let bundle = json!({"username": "secondary", "password": "secret", "settings": {}});
        vault.save_bundle(&bundle).unwrap();
        assert_eq!(vault.load_bundle().unwrap(), Some(bundle));
        let device = json!({"username": "secondary", "settings": {"device": "pixel"}});
        vault.save_device_bundle(&device).unwrap();
        assert_eq!(vault.load_device_bundle().unwrap(), Some(device));

        let creds = json!({"username": "secondary", "password": "secret"});
        vault.save_credentials(&creds).unwrap();
        assert_eq!(vault.load_credentials().unwrap(), Some(creds));

        let web = json!({"userId": "42", "cookies": {"sessionid": "abc", "csrftoken": "xyz"}});
        vault.save_web_session(&web).unwrap();
        assert_eq!(vault.load_web_session().unwrap(), Some(web));

        vault.clear_bundle().unwrap();
        assert!(vault.load_bundle().unwrap().is_none());
        assert!(vault.load_device_bundle().unwrap().is_none());
        assert!(vault.load_credentials().unwrap().is_none());
        assert!(vault.load_web_session().unwrap().is_none());
    }

    #[test]
    fn clear_web_session_leaves_other_records() {
        let temp = tempfile::tempdir().unwrap();
        let vault = SecretVault::from_parts(temp.path().join("test.hold"), vec![9; 32]).unwrap();
        let creds = json!({"username": "secondary", "password": "secret"});
        vault.save_credentials(&creds).unwrap();
        vault
            .save_web_session(&json!({"cookies": {"sessionid": "abc"}}))
            .unwrap();
        vault.clear_web_session().unwrap();
        assert!(vault.load_web_session().unwrap().is_none());
        assert_eq!(vault.load_credentials().unwrap(), Some(creds));
    }

    #[test]
    fn records_survive_reopening_the_vault() {
        // Simulates an app restart: a second SecretVault over the same snapshot +
        // key must still see records written by the first. Guards against the
        // snapshot being reset to an empty client on launch.
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("reopen.hold");
        let key = vec![5_u8; 32];
        let web = json!({"userId": "1", "cookies": {"sessionid": "abc", "ds_user_id": "1"}});
        {
            let vault = SecretVault::from_parts(path.clone(), key.clone()).unwrap();
            vault.save_web_session(&web).unwrap();
        }
        let reopened = SecretVault::from_parts(path, key).unwrap();
        assert_eq!(reopened.load_web_session().unwrap(), Some(web));
    }
}
