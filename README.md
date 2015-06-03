Firefox Accounts Server
=======================

[![Build Status](https://travis-ci.org/mozilla/fxa-auth-server.svg?branch=master)](https://travis-ci.org/mozilla/fxa-auth-server)

This project implements the core server-side API for Firefox Accounts.  It
provides account, device and encryption-key management for the Mozilla Cloud
Services ecosystem.

[Overview](/docs/overview.md)

[Detailed design document](https://github.com/mozilla/fxa-auth-server/wiki/onepw-protocol)

[Detailed API spec](/docs/api.md)

[Guidelines for Contributing](/CONTRIBUTING.md)

## Prerequisites

* node 0.10.x or higher
* npm

## Install

You'll need node 0.10.x or higher and npm to run the server. On some systems running the server as root will cause working directory permissions issues with node. It is recommended that you create a seperate, standard user to ensure a clean and more secure installation.

Clone the git repository and install dependencies:

    git clone git://github.com/mozilla/fxa-auth-server.git
    cd fxa-auth-server
    npm install

To start the server in dev mode (ie. `NODE_ENV=dev`), run:

    npm start

This runs a script `scripts/start-local.sh` as defined in `package.json`. This will start up
4 services, three of which listen on the following ports (by default):

* `bin/key_server.js` on port 9000
* `test/mail_helper.js` on port 9001
* `./node_modules/fxa-customs-server/bin/customs_server.js` on port 7000
* `bin/notifier.js` (no port)

When you `Ctrl-c` your server, all 4 processes will be stopped.

## Testing

Run tests with:

    npm test

* Note: stop the auth-server before running tests. Otherwise, they will fail with obscure errors.

## Reference Client

https://github.com/mozilla/fxa-js-client


## Dev Deployment

There is a development server running the moz-svc-dev AWS environment, at the following address:

    https://api-accounts.dev.lcip.org/

It is managed using [awsbox](http://awsbox.org/).  You can force-push a particular version of the code by doing:

    $> git remote add api-dev-lcip-org app@api-accounts.dev.lcip.org:git
    $> git push api-dev-lcip-org HEAD:master


The dev deployment is configured to send emails via Amazon SES.  If you need to re-create, or want to stand up a similar server, you will need to:

  1.  Obtain the SES SMTP credentials; ping @rfk or @zaach for details.
  2.  Deploy the new machine using awsbox.
  3.  Configure postfix to use the SES credentials:
      1.  Edit /etc/postfix/sasl_passwd to insert the SES credentials.
      2.  Run `/usr/sbin/postmap /etc/postfix/sasl_passwd` to compile them.
      3.  Edit /etc/postfix/main.cf to change 'relayhost' to the SES SMTP host
          (typically "email-smtp.us-east-1.amazonaws.com:587").
      4.  Run `service postfix restart` to restart postfix.


There is also a "bleeding edge" development server that is configured to
auto-update itself from the latest github master.  It may be useful for testing
out new protocol changes, but should be considered unstable for general
development use:

    https://api-accounts-latest.dev.lcip.org/


### Configuration

To set the url of the [content server](https://github.com/mozilla/fxa-content-server/), set enviornment variable `CONTENT_SERVER_URL` to your server urls

    CONTENT_SERVER_URL=http://your.content.server.org

### Troubleshooting

Firefox Accounts authorization is a complicated flow.  You can get verbose logging by adjusting the log level in the `config.json` on your deployed instance.  Add a stanza like:

    "log": {
      "level": "trace"
    }

Valid `level` values (from least to most verbose logging) include: `"fatal", "error", "warn", "info", "trace", "debug"`.

## MySQL setup

### Install MySQL

#### Mac

Installation is easy with homebrew. I use mariadb which is a fork of mysql but either should work.

    brew install mariadb

Follow the homebrew instructions for starting the server. I usually just do

    mysql.server start

#### Linux

[Install MySQL](http://bit.ly/19XPRZf) and start it.

### Database Patches

Previously the database patches were contained in this repo and were run when the server started up (in development mode). However, there is a new backend service that this project will use as we go forward. Whilst the database connection and API code is still contained and used in this repo you should take a look at the [fxa-auth-db-server](https://github.com/mozilla/fxa-auth-db-server/) repo for the SQL that you should run once you have your database set up, specifically the instructions on [Creating the Database](https://github.com/mozilla/fxa-auth-db-server/#creating-the-database). Note where the schema [patches](https://github.com/mozilla/fxa-auth-db-server/tree/master/db/schema) live, in case you need them.

As we switch over to the httpdb backend, the instructions here and in the *fxa-auth-db-server* repo will be updated to clarify this. We know this isn't optimal for now but it is temporary during this transition.

### Execution

Our test suite assumes mysql uses it's default configuration. See `config/config.js` for the override ENV variables if you have different root user password or other user. Now you should be able to run the test suite from the project root directory.

    DB_BACKEND=mysql npm test

Or run the local server

    DB_BACKEND=mysql npm start


### Cleanup

You may want to clear the data from the database periodically. I just drop the database:

    mysql -uroot -e"DROP DATABASE fxa"

The server will automatically re-create it on next use.

## Using with FxOS

By default, FxOS uses the production Firefox Accounts server (`api.accounts.firefox.com/v1`). If you want to use a different account server on a device, you need to update a preference value `identity.fxaccounts.auth.uri`.

* Download this script: https://gist.github.com/edmoz/5596162
* `chmod +x modPref.sh; ./modPref.sh pull`
* Edit `prefs.js` to change `identity.fxaccounts.auth.uri`, e.g., add a line
```
user_pref("identity.fxaccounts.auth.uri", "https://api-accounts.stage.mozaws.net/v1");
```
* `./modPref.sh push prefs.js`

## License

MPL 2.0
