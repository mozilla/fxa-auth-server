/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

require('envc')()

var fs = require('fs')
var path = require('path')
var url = require('url')
var convict = require('convict')
var DEFAULT_SUPPORTED_LANGUAGES = require('./supportedLanguages')

var conf = convict({
  env: {
    doc: 'The current node.js environment',
    default: 'prod',
    format: [ 'dev', 'test', 'stage', 'prod' ],
    env: 'NODE_ENV'
  },
  geodb: {
    dbPath: {
      doc: 'Path to the maxmind database file',
      default: path.resolve(__dirname, '../node_modules/fxa-geodb/db/cities-db.mmdb'),
      env: 'GEODB_DBPATH',
      format: String
    },
    enabled: {
      doc: 'kill-switch for geodb',
      default: true,
      env: 'GEODB_ENABLED',
      format: Boolean
    }
  },
  log: {
    level: {
      default: 'info',
      env: 'LOG_LEVEL'
    },
    fmt: {
      format: ['heka', 'pretty'],
      default: 'heka',
      env: 'LOG_FORMAT'
    }
  },
  memcached: {
    address: {
      doc: 'Address:port of the memcached server (or `none` to disable memcached)',
      default: '127.0.0.1:11211',
      env: 'MEMCACHE_METRICS_CONTEXT_ADDRESS'
    },
    idle: {
      doc: 'Idle timeout for memcached connections (milliseconds)',
      format: Number,
      default: 30000,
      env: 'MEMCACHE_METRICS_CONTEXT_IDLE'
    },
    lifetime: {
      doc: 'Lifetime for memcached values (seconds)',
      format: 'nat',
      default: 1800,
      env: 'MEMCACHE_METRICS_CONTEXT_LIFETIME'
    }
  },
  publicUrl: {
    format: 'url',
    default: 'http://127.0.0.1:9000',
    env: 'PUBLIC_URL'
  },
  domain: {
    format: 'url',
    doc: 'Derived automatically from publicUrl',
    default: undefined
  },
  secretKeyFile: {
    format: String,
    default: path.resolve(__dirname, '../config/secret-key.json'),
    env: 'SECRET_KEY_FILE'
  },
  publicKeyFile: {
    format: String,
    default: path.resolve(__dirname, '../config/public-key.json'),
    env: 'PUBLIC_KEY_FILE'
  },
  oldPublicKeyFile: {
    format: String,
    doc: 'Previous publicKeyFile, used for key rotation',
    default: undefined,
    env: 'OLD_PUBLIC_KEY_FILE'
  },
  trustedJKUs: {
    format: Array,
    default: [],
    env: 'TRUSTED_JKUS'
  },
  db: {
    backend: {
      default: 'httpdb',
      env: 'DB_BACKEND'
    }
  },
  httpdb: {
    url: {
      doc: 'database api url',
      default: 'http://127.0.0.1:8000',
      env: 'HTTPDB_URL'
    }
  },
  listen: {
    host: {
      doc: 'The ip address the server should bind',
      default: '127.0.0.1',
      format: 'ipaddress',
      env: 'IP_ADDRESS'
    },
    port: {
      doc: 'The port the server should bind',
      default: 9000,
      format: 'port',
      env: 'PORT'
    }
  },
  customsUrl: {
    doc: 'fraud / abuse server url',
    default: 'http://127.0.0.1:7000',
    env: 'CUSTOMS_SERVER_URL'
  },
  contentServer: {
    url: {
      doc: 'The url of the corresponding fxa-content-server instance',
      default: 'http://127.0.0.1:3030',
      env: 'CONTENT_SERVER_URL'
    }
  },
  smtp: {
    api: {
      host: {
        doc: 'host for test/mail_helper.js',
        default: '127.0.0.1',
        env: 'MAILER_HOST'
      },
      port: {
        doc: 'port for test/mail_helper.js',
        default: 9001,
        env: 'MAILER_PORT'
      }
    },
    host: {
      doc: 'SMTP host for sending email',
      default: 'localhost',
      env: 'SMTP_HOST'
    },
    port: {
      doc: 'SMTP port',
      default: 25,
      env: 'SMTP_PORT'
    },
    secure: {
      doc: 'Connect to SMTP host securely',
      default: false,
      env: 'SMTP_SECURE'
    },
    user: {
      doc: 'SMTP username',
      format: String,
      default: undefined,
      env: 'SMTP_USER'
    },
    password: {
      doc: 'SMTP password',
      format: String,
      default: undefined,
      env: 'SMTP_PASS'
    },
    sender: {
      doc: 'email address of the sender',
      default: 'Firefox Accounts <no-reply@lcip.org>',
      env: 'SMTP_SENDER'
    },
    verificationUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: undefined,
      env: 'VERIFY_URL',
      arg: 'verify-url'
    },
    verifyLoginUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: undefined,
      env: 'VERIFY_LOGIN_URL',
      arg: 'verify-login-url'
    },
    passwordResetUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: undefined,
      env: 'RESET_URL',
      arg: 'reset-url'
    },
    accountUnlockUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: undefined,
      env: 'UNLOCK_URL',
      arg: 'unlock-url'
    },
    initiatePasswordResetUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: undefined
    },
    syncUrl: {
      doc: 'url to Sync product page',
      format: String,
      default: 'https://www.mozilla.org/firefox/sync/'
    },
    androidUrl: {
      doc: 'url to Android product page',
      format: String,
      default: 'https://www.mozilla.org/firefox/android/'
    },
    iosUrl: {
      doc: 'url to IOS product page',
      format: String,
      default: 'https://www.mozilla.org/firefox/ios/'
    },
    signInUrl: {
      doc: 'Deprecated. uses contentServer.url',
      format: String,
      default: 'undefined'
    },
    supportUrl: {
      doc: 'url to Mozilla Support product page',
      format: String,
      default: 'https://support.mozilla.org/kb/im-having-problems-with-my-firefox-account'
    },
    redirectDomain: {
      doc: 'Domain that mail urls are allowed to redirect to',
      format: String,
      default: 'firefox.com',
      env: 'REDIRECT_DOMAIN'
    },
    privacyUrl: {
      doc: 'url to Mozilla privacy page',
      format: String,
      default: 'https://www.mozilla.org/privacy'
    },
    passwordManagerInfoUrl: {
      doc: 'url to Firefox password manager information',
      format: String,
      default: 'https://support.mozilla.org/kb/password-manager-remember-delete-change-and-import#w_viewing-and-deleting-passwords'
    }
  },
  maxEventLoopDelay: {
    doc: 'Max event-loop delay before which incoming requests are rejected',
    default: 0,
    env: 'MAX_EVENT_LOOP_DELAY'
  },
  scrypt: {
    maxPending: {
      doc: 'Max number of scrypt hash operations that can be pending',
      default: 0,
      env: 'SCRYPT_MAX_PENDING'
    }
  },
  i18n: {
    defaultLanguage: {
      format: String,
      default: 'en',
      env: 'DEFAULT_LANG'
    },
    supportedLanguages: {
      format: Array,
      default: DEFAULT_SUPPORTED_LANGUAGES,
      env: 'SUPPORTED_LANGS'
    }
  },
  tokenLifetimes: {
    accountResetToken: {
      format: 'duration',
      env: 'ACCOUNT_RESET_TOKEN_TTL',
      default: '15 minutes'
    },
    passwordForgotToken: {
      format: 'duration',
      env: 'PASSWORD_FORGOT_TOKEN_TTL',
      default: '60 minutes'
    },
    passwordChangeToken: {
      format: 'duration',
      env: 'PASSWORD_CHANGE_TOKEN_TTL',
      default: '15 minutes'
    }
  },
  verifierVersion: {
    doc: 'verifer version for new and changed passwords',
    format: 'int',
    env: 'VERIFIER_VERSION',
    default: 1
  },
  snsTopicArn: {
    doc: 'Amazon SNS topic on which to send account event notifications. Set to "disabled" to turn off the notifier',
    format: String,
    env: 'SNS_TOPIC_ARN',
    default: ''
  },
  bounces: {
    region: {
      doc: 'The region where the queues live, most likely the same region we are sending email e.g. us-east-1, us-west-2',
      format: String,
      env: 'BOUNCE_REGION',
      default: ''
    },
    bounceQueueUrl: {
      doc: 'The bounce queue URL to use (should include https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>)',
      format: String,
      env: 'BOUNCE_QUEUE_URL',
      default: ''
    },
    complaintQueueUrl: {
      doc: 'The complaint queue URL to use (should include https://sqs.<region>.amazonaws.com/<account-id>/<queue-name>)',
      format: String,
      env: 'COMPLAINT_QUEUE_URL',
      default: ''
    }
  },
  verificationReminders: {
    rate: {
      doc: 'Rate of users getting the verification reminder. If "0" then the feature is disabled. If "1" all users get it.',
      default: 0,
      env: 'VERIFICATION_REMINDER_RATE'
    }
  },
  useHttps: {
    doc: 'set to true to serve directly over https',
    env: 'USE_TLS',
    default: false
  },
  keyPath: {
    doc: 'path to SSL key in PEM format if serving over https',
    env: 'TLS_KEY_PATH',
    default: path.resolve(__dirname, '../key.pem')
  },
  certPath: {
    doc: 'path to SSL certificate in PEM format if serving over https',
    env: 'TLS_CERT_PATH',
    default: path.resolve(__dirname, '../cert.pem')
  },
  lockoutEnabled: {
    doc: 'Is account lockout enabled',
    format: Boolean,
    env: 'LOCKOUT_ENABLED',
    default: false
  },
  newLoginNotificationEnabled: {
    doc: 'Is the new-login notification email enabled',
    format: Boolean,
    env: 'NEW_LOGIN_NOTIFICATION_ENABLED',
    default: true
  },
  // A safety switch to disable device metadata updates,
  // in case problems with the client logic cause server overload.
  deviceUpdatesEnabled: {
    doc: 'Are updates to device metadata enabled?',
    format: Boolean,
    env: 'DEVICE_UPDATES_ENABLED',
    default: true
  },
  // A safety switch to disable device-driven notifications,
  // in case problems with the client logic cause server overload.
  deviceNotificationsEnabled: {
    doc: 'Are device-driven notifications enabled?',
    format: Boolean,
    env: 'DEVICE_NOTIFICATIONS_ENABLED',
    default: true
  },
  oauth: {
    url: {
      format: 'url',
      doc: 'URL at which to verify OAuth tokens',
      default: 'http://localhost:9010',
      env: 'OAUTH_URL'
    },
    keepAlive: {
      format: Boolean,
      doc: 'Use HTTP keep-alive connections when talking to oauth server',
      env: 'OAUTH_KEEPALIVE',
      default: false
    },
    extra: {
      email: {
        doc: 'Temporary extra parameter to prevent request recursion',
        default: false
      }
    }
  },
  statsd: {
    enabled: {
      doc: 'enable UDP based statsd reporting',
      default: true,
      env: 'STATSD_ENABLE'
    },
    host: {
      doc: 'StatsD host for sending logging events',
      default: 'localhost',
      env: 'STATSD_HOST'
    },
    port: {
      format: 'port',
      default: 8125,
      env: 'STATSD_PORT'
    },
    sample_rate: {
      doc: 'statsd sample rate',
      default: 0.1,
      env: 'STATSD_SAMPLE_RATE'
    }
  },
  metrics: {
    flow_id_key: {
      default: 'YOU MUST CHANGE ME',
      doc: 'FlowId validation key, as used by content-server',
      format: String,
      env: 'FLOW_ID_KEY'
    },
    flow_id_expiry: {
      doc: 'Time after which flowIds are considered stale.',
      format: 'duration',
      default: '30 minutes',
      env: 'FLOW_ID_EXPIRY'
    }
  },
  corsOrigin: {
    doc: 'Value for the Access-Control-Allow-Origin response header',
    format: Array,
    env: 'CORS_ORIGIN',
    default: ['*']
  },
  clientAddressDepth: {
    doc: 'location of the client ip address in the remote address chain',
    format: Number,
    env: 'CLIENT_ADDRESS_DEPTH',
    default: 3
  },
  signinConfirmation: {
    enabled: {
      doc: 'enable signin confirmation',
      default: false,
      env: 'SIGNIN_CONFIRMATION_ENABLED'
    },
    sample_rate: {
      doc: 'signin confirmation sample rate, between 0.0 and 1.0',
      default: 1.0,
      env: 'SIGNIN_CONFIRMATION_RATE'
    },
    supportedClients: {
      doc: 'support sign-in confirmation for only these clients',
      format: Array,
      default: [
        'iframe',
        'fx_firstrun_v1',
        'fx_firstrun_v2',
        'fx_desktop_v1',
        'fx_desktop_v2',
        'fx_desktop_v3',
        'fx_ios_v1',
        'fx_ios_v2',
        'fx_fennec_v1'
      ],
      env: 'SIGNIN_CONFIRMATION_SUPPORTED_CLIENTS'
    },
    forceEmailRegex: {
      doc: 'If feature enabled, force sign-in confirmation for email addresses matching this regex.',
      format: Array,
      default: [
        '.+@mozilla\.com$'
      ],
      env: 'SIGNIN_CONFIRMATION_FORCE_EMAIL_REGEX'
    }
  }
})

// handle configuration files.  you can specify a CSV list of configuration
// files to process, which will be overlayed in order, in the CONFIG_FILES
// environment variable.

var files = (process.env.CONFIG_FILES || '').split(',').filter(fs.existsSync)
conf.loadFile(files)
conf.validate({ strict: true })

// set the public url as the issuer domain for assertions
conf.set('domain', url.parse(conf.get('publicUrl')).host)

// derive fxa-auth-mailer configuration from our content-server url
conf.set('smtp.accountUnlockUrl', conf.get('contentServer.url') + '/v1/complete_unlock_account')
conf.set('smtp.authorizeLoginUrl', conf.get('contentServer.url') + '/complete_signin_authorization')
conf.set('smtp.rejectAuthorizeLoginUrl', conf.get('contentServer.url') + '/reject_authorize_login')
conf.set('smtp.initiatePasswordChangeUrl', conf.get('contentServer.url') + '/settings/change_password')
conf.set('smtp.initiatePasswordResetUrl', conf.get('contentServer.url') + '/reset_password')
conf.set('smtp.passwordResetUrl', conf.get('contentServer.url') + '/v1/complete_reset_password')
conf.set('smtp.signInUrl', conf.get('contentServer.url') + '/signin')
conf.set('smtp.verificationUrl', conf.get('contentServer.url') + '/v1/verify_email')
conf.set('smtp.verifyLoginUrl', conf.get('contentServer.url') + '/complete_signin')
conf.set('isProduction', conf.get('env') === 'prod')

module.exports = conf
