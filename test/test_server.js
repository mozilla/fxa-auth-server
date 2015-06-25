/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var cp = require('child_process')
var crypto = require('crypto')
var P = require('../lib/promise')
var request = require('request')
var mailbox = require('./mailbox')
var createDBServer = require('fxa-auth-db-mem')

function TestServer(config, printLogs) {
  this.printLogs = printLogs === false ? false : true
  this.config = config
  this.server = null
  this.mail = null
  this.oauth = null
  this.mailbox = mailbox(config.smtp.api.host, config.smtp.api.port)
}

function waitLoop(testServer, url, cb) {
  request(
    url + '/__heartbeat__',
    function (err, res, body) {
      if (err) {
        if (err.errno !== 'ECONNREFUSED') {
          console.log('ERROR: unexpected result from ' + url)
          console.log(err)
          return cb(err)
        }
        if (!testServer.server) {
          console.log('starting...')
          testServer.start()
        }
        console.log('waiting...')
        return setTimeout(waitLoop.bind(null, testServer, url, cb), 100)
      }
      cb()
    }
  )
}

TestServer.start = function (config, printLogs) {
  var d = P.defer()
  createDBServer().then(
    function (db) {
      db.listen(config.httpdb.url.split(':')[2])
      db.on('error', function () {})
      var testServer = new TestServer(config, printLogs)
      testServer.db = db
      waitLoop(testServer, config.publicUrl, function (err) {
        return err ? d.reject(err) : d.resolve(testServer)
      })
    }
  )
  return d.promise
}

TestServer.prototype.start = function () {
  this.server = cp.spawn(
    'node',
    ['./key_server_stub.js'],
    {
      cwd: __dirname,
      stdio: this.printLogs ? 'pipe' : 'ignore'
    }
  )

  if (this.printLogs) {
    this.server.stdout.on('data', process.stdout.write.bind(process.stdout))
    this.server.stderr.on('data', process.stderr.write.bind(process.stderr))
  }

  // if another instance is already running this will just die which is ok
  this.mail = cp.spawn(
    'node',
    ['./mail_helper.js'],
    {
      cwd: __dirname,
      stdio: this.printLogs ? 'pipe' : 'ignore'
    }
  )
  if (this.printLogs) {
    this.mail.stdout.on('data', process.stdout.write.bind(process.stdout))
    this.mail.stderr.on('data', process.stderr.write.bind(process.stderr))
  }

  if (this.config.oauth.host) {
    this.oauth = cp.spawn(
      'node',
      ['./oauth_helper.js'],
      {
        cwd: __dirname,
        stdio: this.printLogs ? 'pipe' : 'ignore'
      }
    )
    if (this.printLogs) {
      this.oauth.stdout.on('data', process.stdout.write.bind(process.stdout))
      this.oauth.stderr.on('data', process.stderr.write.bind(process.stderr))
    }
  }
}

TestServer.prototype.stop = function () {
  try { this.db.close() } catch (e) {}
  if (this.server) {
    this.server.kill('SIGINT')
    this.mail.kill()
    if (this.oauth) {
      this.oauth.kill()
    }
  }
}

TestServer.prototype.uniqueEmail = function () {
  return crypto.randomBytes(10).toString('hex') + '@restmail.net'
}

TestServer.prototype.mockAccessToken = function (opts) {
  return new Buffer(JSON.stringify(opts)).toString('hex')
}

module.exports = TestServer
