/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// This script will fetch and remove any expired verification reminder
// records from Redis, then send the appropriate emails to the address
// associated with each account. If email fails to send for some reason,
// the affected verification reminders will be reinstated.
//
// It doesn't take any arguments and doesn't include any looping logic.
// It's expected that it will be invoked at regular intervals on the
// fxa-admin box.

'use strict';

const ROOT_DIR = '..';
const LIB_DIR = `${ROOT_DIR}/lib`;

// HACK: Prevent config aborting due to unset secrets
process.env.NODE_ENV = 'dev';

const config = require(`${ROOT_DIR}/config`).getProperties();
const log = require(`${ROOT_DIR}/test/mocks`).mockLog();

const error = require(`${LIB_DIR}/error`);
const oauthdb = require(`${LIB_DIR}/oauthdb`)(log, config);
const Promise = require(`${LIB_DIR}/promise`);
const verificationReminders = require(`${LIB_DIR}/verification-reminders`)(log, config);

const Mailer = require(`${LIB_DIR}/senders/email`)(log, config, oauthdb);

run()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(err => {
    console.error(err.stack);
    process.exit(1);
  });

async function run () {
  const [ allReminders, db, templates, translator ] = await Promise.all([
    verificationReminders.process(),
    require(`${LIB_DIR}/db`)(config, log, {}, {}).connect(config[config.db.backend]),
    require(`${LIB_DIR}/senders/templates`).init(),
    require(`${LIB_DIR}/senders/translator`)(config.i18n.supportedLanguages, config.i18n.defaultLanguage),
  ]);

  const mailer = new Mailer(translator, templates, config.smtp);

  const sent = {};

  await verificationReminders.keys.reduce(async (promise, key) => {
    await promise;

    const method = `verificationReminder${key[0].toUpperCase()}${key.substr(1)}Email`;
    const reminders = allReminders[key];

    console.log(`Processing ${reminders.length} ${key} reminders...`);

    const failedReminders = await reminders.reduce(async (promise, { timestamp, uid }) => {
      const failed = await promise;

      try {
        if (sent[uid]) {
          // Don't send e.g. first and second reminders to the same email from a single batch
          console.log(`  * skipping ${uid}`);
          failed.push({ timestamp, uid });
          return failed;
        }

        const account = await db.account(uid);
        await mailer[method]({
          acceptLanguage: account.locale,
          code: account.emailCode,
          email: account.email,
          uid,
        });
        sent[uid] = true;
      } catch (err) {
        const { errno } = err;
        switch (errno) {
          case error.ERRNO.ACCOUNT_UNKNOWN:
          case error.ERRNO.BOUNCE_COMPLAINT:
          case error.ERRNO.BOUNCE_HARD:
          case error.ERRNO.BOUNCE_SOFT:
            console.log(`  * ignoring deleted/bouncing account ${uid}, errno: ${errno}`);
            await verificationReminders.delete(uid);
            break;
          default:
            console.log(`  * failed ${uid}, errno: ${errno}`);
            console.error(err.stack);
            failed.push({ timestamp, uid });
        }
      }

      return failed;
    }, Promise.resolve([]));

    if (failedReminders.length > 0) {
      console.log(`Reinstating ${reminders.length} failed or skipped ${key} reminders...`);
      return verificationReminders.reinstate(key, failedReminders);
    }
  }, Promise.resolve());

  await db.close();
  await oauthdb.close();
  await verificationReminders.close();
}
