# Firefox Accounts Recovery Keys

To help reduce the risk of a user losing their encrypted data
(ex. passwords, history, bookmarks) during a password reset,
Firefox Account users can create an account recovery key. This
recovery key stores an encrypted version of the
original `kB` and is used to re-bundle the new password during a
password reset.

## Registering Recovery Key

* FxA web-content prompts for the user's password and retrieves kB
* FxA web-content generates a random binary recovery code
  * Recovery code is between 16 and 32 in length
* FxA web-content uses the recovery code to derive the fingerprint and
encryption key (recovery-kid and recovery-key, respectively)
* FxA web-content encrypts kB using recover key
  * Recovery data = JWE(recover-key, {“alg”: “dir”, “enc”: “A256GCM”, “kid”:  recover-kid}, kB)
* FxA web-content submits recovery data to FxA server for
storage associated with the fingerprint (recover-kid)

## Recovering kB

* User completes an email confirmation loop to confirm password reset
  * Results in temporary session credential/token for subsequent requests
* User retrieves recovery code from print out or downloaded file
* FxA web-content uses the recovery code to derive the fingerprint
and encryption key (recover-kid and recover-key, respectively)
* FxA web-content requests recover-data from FxA server, providing recover-kid
  * FxA auth-server checks email-validated user (something they have) provided
  the recover-kid (something they know) is assigned/bound to the recover-data
* FxA web-content decrypts recover-data with recover-key to recover kB
* User enters a new password into web-content
  * FxA web-content wraps kB with new password, submit wrapKb
  to server with account reset request
* Upon successful password reset, the recovery key and recovery data are deleted