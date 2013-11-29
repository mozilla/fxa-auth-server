/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var P = require('p-promise')
var mysql = require('mysql');
var schema = require('fs').readFileSync(__dirname + '/schema.sql', { encoding: 'utf8'})

function uuidToBuffer(uuid) {
  return new Buffer(uuid.replace(/-/g, ''), 'hex');
}

function bufferToUuid(buf) {
  var str = buf.toString('hex');
  var uuid = str.slice(0, 8) + '-' + str.slice(8, 12) + '-' + str.slice(12, 16) + '-' + str.slice(16, 20) + '-' + str.slice(20, 32);
  return uuid;
}

module.exports = function (
  config,
  log,
  error,
  AuthToken,
  SessionToken,
  KeyFetchToken,
  AccountResetToken,
  SrpToken,
  ForgotPasswordToken
  ) {

  // make a pool of connections that we can draw from
  config.waitForConnections = true
  config.connectionLimit = 100
  var pool = mysql.createPool(config)

  function MySql(options) {
  }

  // this will connect to mysql, create the database
  // then create the schema, prior to returning an
  // instance of MySql
  function createSchema(options) {
    var d = P.defer()
    var dbname = options.database
    delete options.database
    options.multipleStatements = true
    var client = mysql.createConnection(options)
    client.query(
      'CREATE DATABASE IF NOT EXISTS ' + dbname,
      function (err) {
        if (err) return d.reject(err)
        client.changeUser(
          {
            user     : options.user,
            password : options.password,
            database : dbname,
          },
          function (err) {
            if (err) return d.reject(err)
            client.query(
              schema,
              function (err) {
                if (err) return d.reject(err)
                client.end(
                  function (err) {
                    if (err) {
                      log.error({ op: 'MySql.createSchemaEnd', err: err.message })
                    }
                  }
                )
                options.database = dbname
                options.multipleStatements = false

                // create the mysql class
                var mysql = new MySql()
                d.resolve(mysql)
              }
            )
          }
        )
      }
    )
    return d.promise
  }

  MySql.create = function () {
    var options = config
    var mysql = new MySql()
    return mysql.connect()
  }

  MySql.prototype.connect = function() {
    var d = P.defer()
    pool.getConnection(function(err, connection) {
      if (err) return d.reject(err)
      this.connection = connection
      d.resolve(connection)
    }.bind(this))
    return d.promise
  }

  MySql.connect = function () {
    var options = config

    if (options.create_schema) {
      return createSchema(options)
    }

    return P(new MySql())
  }

  MySql.close = function () {
    pool.end();
  }

  MySql.prototype.close = function () {
    var d = P.defer()
    pool.end(function(err) {
      return err ? d.reject(err) : d.resolve()
    });
    return d.promise
  }

  MySql.prototype.ping = function () {
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.ping(function (err) {
          return err ? d.reject(err) : d.resolve()
        })
        return d.promise
      })
  }

  // CREATE

  MySql.prototype.createAccount = function (data) {
    log.trace(
      {
        op: 'MySql.createAccount',
        uid: data && data.uid,
        email: data && data.email
      }
    )
    var sql = 'INSERT INTO accounts (uid, email, emailCode, verified, srp, kA, wrapKb, passwordStretching) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'

    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [
            uuidToBuffer(data.uid),
            data.email,
            data.emailCode,
            data.verified,
            JSON.stringify(data.srp),
            data.kA,
            data.wrapKb,
            JSON.stringify(data.passwordStretching)
          ],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(data)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.createSessionToken = function (authToken) {
    log.trace({ op: 'MySql.createSessionToken', uid: authToken && authToken.uid })

    var con

    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return SessionToken.create(authToken)
      })
      .then(function(sessionToken) {
        var d = P.defer()
        con.query(
          'INSERT INTO sessionTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
          [sessionToken.id, sessionToken.data, uuidToBuffer(sessionToken.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(sessionToken)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.createKeyFetchToken = function (authToken) {
    var d = P.defer()
    log.trace({ op: 'MySql.createKeyFetchToken', uid: authToken && authToken.uid })
    var sql = 'INSERT INTO keyfetchTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)'
    var con
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return KeyFetchToken.create(authToken)
      })
      .then(function (keyFetchToken) {
        var d = P.defer()
        con.query(
          sql,
          [keyFetchToken.id, keyFetchToken.data, uuidToBuffer(keyFetchToken.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(keyFetchToken)
          }
        )
        return d.promise
      }.bind(this))
  }

  MySql.prototype.createAccountResetToken = function (token /* authToken|forgotPasswordToken */) {
    log.trace({ op: 'MySql.createAccountResetToken', uid: token && token.uid })
    var sql = 'REPLACE INTO resetTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)'
    var con
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return AccountResetToken.create(token)
      })
      .then(function (accountResetToken) {
        var d = P.defer()
        con.query(
          sql,
          [accountResetToken.id, accountResetToken.data, uuidToBuffer(accountResetToken.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(accountResetToken)
          }
        )
        return d.promise
      }.bind(this))
  }

  MySql.prototype.createAuthToken = function (srpToken) {
    log.trace({ op: 'MySql.createAuthToken', uid: srpToken && srpToken.uid })
    var sql = 'INSERT INTO authTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)'
    var con
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return AuthToken.create(srpToken)
      })
      .then(function(authToken) {
        var d = P.defer()
        con.query(
          sql,
          [authToken.id, authToken.data, uuidToBuffer(authToken.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(authToken)
          }
        )
        return d.promise
      }.bind(this))
  }

  MySql.prototype.createSrpToken = function (emailRecord) {
    log.trace({ op: 'MySql.createSrpToken', uid: emailRecord && emailRecord.uid })
    var sql = 'INSERT INTO srpTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)'

    var con
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return SrpToken.create(emailRecord)
      })
      .then(function (srpToken) {
        var d = P.defer()
        con.query(
          sql,
          [srpToken.id, srpToken.data, uuidToBuffer(srpToken.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(srpToken)
          }
        )
        return d.promise
      }.bind(this))
  }

  MySql.prototype.createForgotPasswordToken = function (emailRecord) {
    log.trace({ op: 'MySql.createForgotPasswordToken', uid: emailRecord && emailRecord.uid })
    var sql = 'REPLACE INTO forgotpwdTokens (tokenid, tokendata, uid, passcode, created, tries) VALUES (?, ?, ?, ?, ?, ?)'
    var con
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return ForgotPasswordToken.create(emailRecord)
      })
      .then(function (forgotPasswordToken) {
        var d = P.defer()
        con.query(
          sql,
          [
            forgotPasswordToken.id,
            forgotPasswordToken.data,
            uuidToBuffer(forgotPasswordToken.uid),
            forgotPasswordToken.passcode,
            forgotPasswordToken.created,
            forgotPasswordToken.tries
          ],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(forgotPasswordToken)
          }
        )
        return d.promise
      }.bind(this))
  }

  // READ

  MySql.prototype.accountExists = function (email) {
    log.trace({ op: 'MySql.accountExists', email: email })
    var sql = 'SELECT uid FROM accounts WHERE email = ?'

    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [email],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(!!results.length)
          }
        )
      return d.promise
      })
  }

  MySql.prototype.accountDevices = function (uid) {
    log.trace({ op: 'MySql.accountDevices', uid: uid })
    var sql = 'SELECT tokenid AS id FROM sessionTokens WHERE uid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [uuidToBuffer(uid)],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(results)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.sessionToken = function (id) {
    log.trace({ op: 'MySql.sessionToken', id: id })
    var sql = 'SELECT t.tokendata, t.uid, a.verified, a.email, a.emailCode' +
              '  FROM sessionTokens t, accounts a WHERE t.tokenid = ? AND t.uid = a.uid'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            var result = results[0]
            SessionToken.fromHex(result.tokendata, result)
              .done(
                function (sessionToken) {
                  sessionToken.uid = bufferToUuid(sessionToken.uid)
                  return d.resolve(sessionToken)
                }
              )
          }
        )
        return d.promise
      })
  }

  MySql.prototype.keyFetchToken = function (id) {
    var d = P.defer()
    log.trace({ op: 'MySql.keyFetchToken', id: id })
    var sql = 'SELECT t.tokendata, t.uid, a.verified, a.kA, a.wrapKb ' +
              '  FROM keyfetchTokens t, accounts a WHERE t.tokenid = ? AND t.uid = a.uid'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            var result = results[0]
            KeyFetchToken.fromHex(result.tokendata, result)
              .done(
                function (keyFetchToken) {
                  keyFetchToken.uid = bufferToUuid(keyFetchToken.uid)
                  return d.resolve(keyFetchToken)
                }
              )
          }
        )
        return d.promise
      })
  }

  MySql.prototype.accountResetToken = function (id) {
    log.trace({ op: 'MySql.accountResetToken', id: id })

    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          'SELECT uid, tokendata FROM resetTokens WHERE tokenid = ?',
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            d.resolve(results[0])
          }
        )
        return d.promise
      })
      .then(function(result) {
        return AccountResetToken.fromHex(result.tokendata, result)
      })
      .then(function(accountResetToken) {
        accountResetToken.uid = bufferToUuid(accountResetToken.uid)
        return P(accountResetToken)
      })
  }

  MySql.prototype.authToken = function (id) {
    log.trace({ op: 'MySql.authToken', id: id })
    var sql = 'SELECT t.uid, t.tokendata, a.verified' +
              '  FROM authTokens t, accounts a' +
              '  WHERE t.tokenid = ? AND t.uid = a.uid'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            var result = results[0]
            AuthToken.fromHex(result.tokendata, result)
              .done(
                function (authToken) {
                  authToken.uid = bufferToUuid(authToken.uid)
                  return d.resolve(authToken)
                }
              )
          }
        )
        return d.promise
      })
  }

  MySql.prototype.srpToken = function (id) {
    log.trace({ op: 'MySql.srpToken', id: id })
    var sql = 'SELECT t.tokendata, t.uid, a.srp, a.passwordStretching ' +
              '  FROM srpTokens t, accounts a ' +
              '  WHERE t.tokenid = ? AND t.uid = a.uid'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            var result = results[0]
            result.srp = JSON.parse(result.srp)
            result.passwordStretching = JSON.parse(result.passwordStretching)
            SrpToken.fromHex(result.tokendata, result)
              .done(
                function (srpToken) {
                  srpToken.uid = bufferToUuid(srpToken.uid)
                  return d.resolve(srpToken)
                }
              )
          }
        )
        return d.promise
      })
  }

  MySql.prototype.forgotPasswordToken = function (id) {
    var d = P.defer()
    log.trace({ op: 'MySql.forgotPasswordToken', id: id })
    var sql = 'SELECT t.tokendata, t.uid, a.email, t.passcode, t.created, t.tries  ' +
              ' FROM forgotpwdTokens t, accounts a WHERE t.tokenid = ? AND t.uid = a.uid'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [id],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.invalidToken())
            var result = results[0]
            ForgotPasswordToken.fromHex(result.tokendata, result)
              .done(
                function (forgotPasswordToken) {
                  forgotPasswordToken.uid = bufferToUuid(forgotPasswordToken.uid)
                  return d.resolve(forgotPasswordToken)
                }
              )
          }
        )
        return d.promise
      })
  }

  MySql.prototype.emailRecord = function (email) {
    log.trace({ op: 'MySql.emailRecord', email: email })
    var sql = 'SELECT uid, verified, srp, passwordStretching FROM accounts WHERE email = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [email],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.unknownAccount())
            var result = results[0]
            return d.resolve({
              uid: bufferToUuid(result.uid),
              email: email,
              verified: !!result.verified,
              srp: JSON.parse(result.srp),
              passwordStretching: JSON.parse(result.passwordStretching)
            })
          }
        )
        return d.promise
      })
  }

  MySql.prototype.account = function (uid) {

    log.trace({ op: 'MySql.account', uid: uid })
    var sql = 'SELECT email, emailCode, verified, srp, kA, wrapKb, passwordStretching ' +
              '  FROM accounts WHERE uid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [uuidToBuffer(uid)],
          function (err, results) {
            con.release()
            if (err) return d.reject(err)
            if (!results.length) return d.reject(error.unknownAccount())
            var result = results[0]
              console.log(result)
            return d.resolve({
              uid: uid,
              email: result.email,
              emailCode: result.emailCode,
              verified: !!result.verified,
              kA: result.kA,
              wrapKb: result.wrapKb,
              srp: JSON.parse(result.srp),
              passwordStretching: JSON.parse(result.passwordStretching)
            })
          }
        )
        return d.promise
      })
  }

  // UPDATE

  MySql.prototype.updateForgotPasswordToken = function (forgotPasswordToken) {
    log.trace({ op: 'MySql.udateForgotPasswordToken', uid: forgotPasswordToken && forgotPasswordToken.uid })
    var sql = 'UPDATE forgotpwdTokens SET tries = ? WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [forgotPasswordToken.tries, forgotPasswordToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  // DELETE

  MySql.prototype.deleteAccount = function (authToken) {
    log.trace({ op: 'MySql.deleteAccount', uid: authToken && authToken.uid })
    var con
    return getConnection()
      .then(function(newCon) {
        con = newCon
        return beginTransaction(con)
      })
      .then(function() {
        var tables = ['sessionTokens', 'keyfetchTokens', 'authTokens', 'srpTokens',
                      'resetTokens', 'forgotpwdTokens', 'accounts']
        var all = [];
        var uid = uuidToBuffer(authToken.uid)
        tables.forEach(function(tablename) {
          all.push(deleteFromTableUsingUid(con, tablename, uid))
        })
        return P.all(all)
      })
      .then(function() {
        return commitTransaction(con).then(function() {
          con.release()
        })
      })
  }

  MySql.prototype.deleteSessionToken = function (sessionToken) {
    log.trace(
      {
        op: 'MySql.deleteSessionToken',
        id: sessionToken && sessionToken.id,
        uid: sessionToken && sessionToken.uid
      }
    )
    var sql = 'DELETE FROM sessionTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [sessionToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.deleteKeyFetchToken = function (keyFetchToken) {
    log.trace(
      {
        op: 'MySql.deleteKeyFetchToken',
        id: keyFetchToken && keyFetchToken.id,
        uid: keyFetchToken && keyFetchToken.uid
      }
    )
    var sql = 'DELETE FROM keyfetchTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [keyFetchToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.deleteAccountResetToken = function (accountResetToken) {
    log.trace(
      {
        op: 'MySql.deleteAccountResetToken',
        id: accountResetToken && accountResetToken.id,
        uid: accountResetToken && accountResetToken.uid
      }
    )
    var sql = 'DELETE FROM resetTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [accountResetToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.deleteAuthToken = function (authToken) {
    log.trace(
      {
        op: 'MySql.deleteAuthToken',
        id: authToken && authToken.id,
        uid: authToken && authToken.uid
      }
    )
    var sql = 'DELETE FROM authTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [authToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.deleteSrpToken = function (srpToken) {
    log.trace(
      {
        op: 'MySql.deleteSrpToken',
        id: srpToken && srpToken.id,
        uid: srpToken && srpToken.uid
      }
    )
    var sql = 'DELETE FROM srpTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [srpToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.deleteForgotPasswordToken = function (forgotPasswordToken) {
    log.trace(
      {
        op: 'MySql.deleteForgotPasswordToken',
        id: forgotPasswordToken && forgotPasswordToken.id,
        uid: forgotPasswordToken && forgotPasswordToken.uid
      }
    )
    var sql = 'DELETE FROM forgotpwdTokens WHERE tokenid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [forgotPasswordToken.id],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  // BATCH

  MySql.prototype.resetAccount = function (accountResetToken, data) {
    log.trace({ op: 'MySql.resetAccount', uid: accountResetToken && accountResetToken.uid })
    var con
    return getConnection()
      .then(function(newCon) {
        con = newCon
        return beginTransaction(con)
      })
      .then(function() {
        var tables = ['sessionTokens', 'keyfetchTokens', 'authTokens', 'srpTokens',
                      'resetTokens', 'forgotpwdTokens']
        var all = [];
        var uid = uuidToBuffer(accountResetToken.uid)
        tables.forEach(function(tablename) {
          all.push(deleteFromTableUsingUid(con, tablename, uid))
        })
        return P.all(all)
      })
      .then(function() {
        var d = P.defer()
        var sql = 'UPDATE accounts SET srp = ?, wrapKb = ?, passwordStretching = ? ' +
                  ' WHERE uid = ?'
        con.query(
          sql,
          [
            JSON.stringify(data.srp),
            data.wrapKb,
            JSON.stringify(data.passwordStretching),
            uuidToBuffer(accountResetToken.uid),
          ],
          function (err) {
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
      .then(function() {
          return commitTransaction(con).then(function() {
            con.release()
          })
      })
  }

  MySql.prototype.authFinish = function (srpToken) {
    log.trace({ op: 'MySql.authFinish', uid: srpToken && srpToken.uid })

    // Order of events:
    // (1) make an AuthToken
    // (2) get a connection
    // (3) start a transaction
    // (4) delete from srpTokens
    // (5) insert into authTokens
    // (6) commit transaction
    // (7) release connection

    var con
    var authToken
    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return beginTransaction(con)
      })
      .then(function() {
        return AuthToken.create(srpToken)
      })
      .then(function (newAuthToken) {
        authToken = newAuthToken
        var d = P.defer()
        con.query(
          'DELETE FROM srpTokens WHERE tokenid = ?',
          [srpToken.id],
          function(err) {
            if (err) d.reject(err)
            d.resolve()
          }
        )
        return d.promise
      })
      .then(function() {
        var d = P.defer()
        con.query(
          'INSERT INTO authTokens(tokenid, tokendata, uid) VALUES (?, ?, ?)',
          [authToken.id, authToken.data, uuidToBuffer(authToken.uid)],
          function(err) {
            if (err) d.reject(err)
            d.resolve(authToken)
          }
        )
        return d.promise
      })
      .then(function() {
          return commitTransaction(con).then(function() {
            con.release()
          })
      })
      .then(function() {
          var d = P.defer()
          d.resolve(authToken)
          return d.promise
      })
  }

  MySql.prototype.createSession = function (authToken) {
    log.trace({ op: 'MySql.createSession', uid: authToken && authToken.uid })
    // TODO: transactions not working with nodejs driver.
    // For now, we just insert one after the other and hope for best. :-(
    var con
    return P.all(
      [
        KeyFetchToken.create(authToken),
        SessionToken.create(authToken)
      ]
    )
    .then(function (tokens) {
      var keyFetchToken = tokens[0]
      var sessionToken = tokens[1]

      return getConnection()
        .then(function(thisCon) {
          con = thisCon
          return beginTransaction(con)
        })
        .then(function(thisCon) {
          var d = P.defer()
          con.query(
            'DELETE FROM authTokens WHERE tokenid = ?',
            [authToken.id],
            function(err) {
              if (err) return d.reject(err)
              d.resolve()
            }
          )
          return d.promise
        })
        .then(function() {
          var d = P.defer()
          con.query(
            'INSERT INTO keyfetchTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
            [keyFetchToken.id, keyFetchToken.data, uuidToBuffer(keyFetchToken.uid)],
            function(err) {
              if (err) return d.reject(err)
              d.resolve()
            }
          )
          return d.promise
        })
        .then(function() {
          var d = P.defer()
          con.query(
            'INSERT INTO sessionTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
            [sessionToken.id, sessionToken.data, uuidToBuffer(sessionToken.uid)],
            function(err) {
              if (err) return d.reject(err)
              // now commit and release
              commitTransaction(con).then(function() {
                con.release()
              })
              d.resolve({
                keyFetchToken: keyFetchToken,
                sessionToken: sessionToken
              })
            }
          )
          return d.promise
        })
      })
  }

  MySql.prototype.verifyEmail = function (account) {
    log.trace({ op: 'MySql.verifyEmail', uid: account && account.uid })
    var sql = 'UPDATE accounts SET verified = true WHERE uid = ?'
    return getConnection()
      .then(function(con) {
        var d = P.defer()
        con.query(
          sql,
          [uuidToBuffer(account.uid)],
          function (err) {
            con.release()
            if (err) return d.reject(err)
            d.resolve(true)
          }
        )
        return d.promise
      })
  }

  MySql.prototype.createPasswordChange = function (authToken) {
    log.trace({ op: 'MySql.createPasswordChange', uid: authToken && authToken.uid })
    var con
    return P.all(
      [
        KeyFetchToken.create(authToken),
        AccountResetToken.create(authToken)
      ]
    )
    .then(function (tokens) {
      var keyFetchToken = tokens[0]
      var accountResetToken = tokens[1]

      return getConnection()
        .then(function(thisCon) {
          con = thisCon
          return beginTransaction(con)
        })
        .then(function(thisCon) {
          var d = P.defer()
          con.query(
            'DELETE FROM authTokens WHERE tokenid = ?',
            [authToken.id],
            function(err) {
              if (err) return d.reject(err)
                console.log('right here 3')
              d.resolve()
            }
          )
          return d.promise
        })
        .then(function() {
          var d = P.defer()
          con.query(
            'INSERT INTO keyfetchTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
            [keyFetchToken.id, keyFetchToken.data, uuidToBuffer(keyFetchToken.uid)],
            function(err) {
                console.log('right here 2')
              if (err) return d.reject(err)
              d.resolve()
            }
          )
          return d.promise
        })
        .then(function() {
          var d = P.defer()
          con.query(
            'REPLACE INTO resetTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
            [accountResetToken.id, accountResetToken.data, uuidToBuffer(accountResetToken.uid)],
            function(err) {
              if (err) return d.reject(err)
              d.resolve()
            }
          )
          return d.promise
        })
        .then(function() {
            return commitTransaction(con)
        })
        .then(function() {
          con.release()
          return P({
            keyFetchToken: keyFetchToken,
            accountResetToken: accountResetToken
          })
        })
      })
  }

  MySql.prototype.forgotPasswordVerified = function (forgotPasswordToken) {
    log.trace({ op: 'MySql.forgotPasswordVerified', uid: forgotPasswordToken && forgotPasswordToken.uid })

    var con
    var accountResetToken

    return getConnection()
      .then(function(thisCon) {
        con = thisCon
        return beginTransaction(con)
      })
      .then(function() {
        return AccountResetToken.create(forgotPasswordToken)
      })
      .then(function(newAccountResetToken) {
        accountResetToken = newAccountResetToken
        var d = P.defer()
        con.query(
          'DELETE FROM forgotpwdTokens WHERE tokenid = ?',
          [forgotPasswordToken.id],
          function (err) {
            if (err) return d.reject(err)
            d.resolve()
          }
        )
        return d.promise
      })
      .then(function() {
        var d = P.defer()
        con.query(
          'REPLACE INTO resetTokens (tokenid, tokendata, uid) VALUES (?, ?, ?)',
          [accountResetToken.id, accountResetToken.data, uuidToBuffer(accountResetToken.uid)],
          function (err) {
            if (err) return d.reject(err)
            d.resolve(accountResetToken)
          }
        )
        return d.promise
      })
      .then(function(newAccountResetToken) {
          accountResetToken = newAccountResetToken
          return commitTransaction(con).then(function() {
            con.release()
          })
      })
      .then(function() {
          return P(accountResetToken)
      })
  }

  // helper functions
  function getConnection() {
    var d = P.defer()
    pool.getConnection(function(err, connection) {
      if (err) return d.reject(err)
      d.resolve(connection)
    })
    return d.promise
  }

  function beginTransaction(client) {
    var d = P.defer()
    client.query('BEGIN', function(err, con) {
      if (err) return d.reject(err)
      d.resolve(con)
    })
    return d.promise
  }

  function commitTransaction(client) {
    var d = P.defer()
    client.query('COMMIT', function(err) {
      if (err) {
        client.query('ROLLBACK', function() {
          d.reject(err)
        })
        return
      }
      d.resolve()
    })
    return d.promise
  }

  function deleteFromTableUsingUid(client, table, uid) {
    var d = P.defer()

    var sql = 'DELETE FROM ' + table + ' WHERE uid = ?'
    client.query(
      sql,
      [uid],
      function(err, res) {
        if (err) return d.reject(err)
        d.resolve(res)
      }
    )

    return d.promise
  }

  return MySql
}
