const uuid = require('uuid');
const async = require('async');
const Hapi = require('hapi');
const config = require('./config');
const kv = require('./kv');
const util = require('./util');

var internalError = Hapi.Error.internal;
var badRequest = Hapi.Error.badRequest;
var notFound = Hapi.Error.notFound;


/* user account model
 *
 * <email>/uid = <userId>
 *
 * <userId>/user = {
 *  params: <user params>
 *  verifier: <password verifier>
 *  kA: <kA key>
 *  kB: <wrapped kB key>
 *  accountTokens: {}
 *  resetTokens: {}
 *  signTokens: {}
 * }
 *
 * <sessionId>/session = {
 *  uid: <userId>
 * }
 *
 * <accountToken>/accountToken = {
 *  uid: <userId>
 * }
 *
 * <resetToken>/resetToken = {
 *  uid: <userId>
 * }
 *
 * <signToken>/signer = {
 *  uid: <userId>
 * }
 *
 * */

exports.create = function(data, cb) {
  // generate user id
  var userId = util.getUserId();
  var userKey = userId + '/user';

  async.waterfall([
    // ensure that an account doesn't already exist for the email
    function(cb) {
      kv.store.get(data.email + '/uid', function (err, doc) {
        if (doc) return cb(badRequest('AccountExistsForEmail'));
        cb(null);
      });
    },
    // link email to userid
    function(cb) {
      kv.store.set(data.email + '/uid', userId, cb);
    },
    // get new class A key
    util.getKA,
    // create user account
    function(key, cb) {
      kv.store.set(userKey, {
        params: data.params,
        verifier: data.verifier,
        kA: key,
        kB: data.kB,
        accountTokens: {},
        resetTokens: {},
        signTokens: {}
      }, cb);
    }
  ], cb);
};

// Initialize the SRP process
exports.startLogin = function(email, cb) {
  async.waterfall([
    // get uid
    exports.getId.bind(null, email),
    // create a temporary session document
    function (uid, cb) {
      // get sessionID
      var sid = util.getSessionId();

      // eventually will store SRP state
      // and expiration time
      kv.cache.set(sid + '/session', {
        uid: uid
      }, function (err) {
        // return sessionID
        cb(err, { sessionId: sid });
      });
    }
  ], cb);
};

// Finish the SRP process and return account info
exports.finishLogin = function(sessionId, verifier, cb) {
  var sessKey = sessionId + '/session';
  var uid, user, accountToken;

  async.waterfall([
    // get session doc
    function(cb) {
      kv.cache.get(sessKey, function(err, session) {
        if (err) return cb(err);
        if (!session) return cb(notFound('UnknownSession'));
        cb(null, session.value);
      });
    },
    // get user info
    function(session, cb) {
      uid = session.uid;
      getUser(session.uid, cb);
    },

    // check password
    function(result, cb) {
      user = result;
      if (user.verifier !== verifier) {
        return cb(badRequest('IncorrectPassword'));
      }
      cb(null);
    },

    // create accountToken
    util.getAccountToken,

    // create temporary account token doc
    function(token, cb) {
      accountToken = token;
      addAccountToken(uid, token, cb);
    },
    // delete session doc
    function(cb) {
      kv.cache.delete(sessKey, cb);
    },
    // return info
    function(cb) {
      cb({
        accountToken: accountToken,
        kA: user.kA,
        kB: user.kB,
      });
    }
  ], cb);
};

// Takes an accountToken and creates a new signToken
exports.getSignToken = function(accountToken, cb) {
  var accountKey = accountToken + '/accountToken';
  var uid, signToken;

  async.waterfall([
    // Check that the accountToken exists
    // and get the associated user id
    function(cb) {
      kv.cache.get(accountKey, function(err, account) {
        if (err) return cb(err);
        if (!account) return cb(notFound('UknownAccountToken'));
        cb(null, account.value.uid);
      });
    },
    // get new signToken
    function(id, cb) {
      uid = id;
      util.getSignToken(cb);
    },
    function(token, cb) {
      signToken = token;
      addSignToken(uid, token, cb);
    },
    // delete account token from user's list
    function(cb) {
      updateUserData(uid, function(userDoc) {
          delete userDoc.value.accountTokens[accountToken];
          return userDoc;
      }, cb);
    },
    // delete accountToken record
    function(cb) {
      kv.cache.delete(accountToken + '/accountToken', cb);
    },
    function(cb) {
      cb(null, { signToken: signToken });
    }
  ], cb);
};

// Takes an accountToken and creates a new resetToken
exports.getResetToken = function(accountToken, cb) {
  var accountKey = accountToken + '/accountToken';
  var uid, resetToken;

  async.waterfall([
    // Check that the accountToken exists
    // and get the associated user id
    function(cb) {
      kv.cache.get(accountKey, function(err, account) {
        if (err) return cb(err);
        if (!account) return cb(notFound('UknownAccountToken'));
        cb(null, account.value.uid);
      });
    },
    // get new resetToken
    function(id, cb) {
      uid = id;
      util.getResetToken(cb);
    },
    function(token, cb) {
      resetToken = token;
      addResetToken(uid, token, cb);
    },
    // delete account token from user's list
    function(cb) {
      updateUserData(uid, function(userDoc) {
          delete userDoc.value.accountTokens[accountToken];
          return userDoc;
      }, cb);
    },
    // delete accountToken record
    function(cb) {
      kv.cache.delete(accountToken + '/accountToken', cb);
    },
    function(cb) {
      cb(null, { resetToken: resetToken });
    }
  ], cb);
};

exports.resetPassword = function(resetToken, data, cb) {
  var userId;

  async.waterfall([
    // Check that the resetToken exists
    // and get the associated user id
    function(cb) {
      kv.cache.get(resetToken + '/resetToken', function(err, doc) {
        if (err) return cb(err);
        if (!doc) return cb(notFound('UknownResetToken'));
        userId = doc.value.uid;
        cb(null);
      });
    },
    // delete all accountTokens, signTokens, and resetTokens
    function(cb) {
      deleteAllTokens(userId, cb);
    },
    // get new class A key
    util.getKA,
    // create user account
    function(key, cb) {
      kv.store.set(userId + '/user', {
        params: data.params,
        verifier: data.verifier,
        kA: key,
        kB: data.kB,
        accountTokens: {},
        resetTokens: {},
        signTokens: {}
      }, cb);
    }
  ], cb);
};

function deleteAllTokens(userId, cb) {
  async.waterfall([
    getUser.bind(null, userId),
    function(user, cb) {
      // map each token into a function that deletes that token's record
      var funs = Object.keys(user.accountTokens).map(function(token) {
          return function(cb) {
            kv.cache.delete(token + '/accountToken', cb);
          };
        })
        .concat(
        Object.keys(user.signTokens).map(function(token) {
          return function(cb) {
            kv.store.delete(token + '/signer', cb);
          };
        }))
        .concat(
        Object.keys(user.resetTokens).map(function(token) {
          return function(cb) {
            kv.cache.delete(token + '/resetToken', cb);
          };
        }));
      // run token deletions in parallel
      async.parallel(funs, function(err) { cb(err); });
    }
  ], cb);
}

function addTokenFn(tokenType, fn) {
  return function (userId, token, cb) {
    async.waterfall([
      // First, add the signToken to the user's list
      function(cb) {
        updateUserData(userId, function(userDoc) {
          if (token in userDoc.value[tokenType]) {
            userDoc.value[tokenType][token] = true;
          }
          return userDoc;
        }, cb);
      },
      fn.bind(null, token, userId),
    ], cb);
  };
}

var addSignToken = addTokenFn('signTokens',
      function(token, userId, cb) {
        kv.store.set(token + '/signer', {
          uid: userId,
          accessTime: Date.now()
        }, cb);
      });

var addAccountToken = addTokenFn('accountTokens',
      function(token, userId, cb) {
        kv.cache.set(token + '/accountToken', {
          uid: userId
        }, cb);
      });

var addResetToken = addTokenFn('resetTokens',
      function(token, userId, cb) {
        kv.cache.set(token + '/resetToken', {
          uid: userId,
          expirationTime: Date.now() + 60 * 60 * 24
        }, cb);
      });

function updateUserData(userId, update, cb) {
  retryLoop('cas mismatch', 5, function(cb) {
    getUserDoc(userId, function(err, doc) {
      try {
        doc = update(doc);
      } catch (e) {
        return cb(e);
      }
      kv.store.cas(userId + '/user', doc.value, doc.casid, cb);
    });
  }, cb);
}

// Helper function to retry execution in case of errors.
// 'fn' should be the function to execute, with its arguments bound
// except for the callback.
//
function retryLoop(errType, maxAttempts, fn, cb) {
  var numRetries = 0;
  var attempt = function() {
    fn(function(err) {
      if (!err) return cb(null);
      if (err !== errType) return cb(err);
      if (numRetries > maxAttempts) return cb('too many conflicts');
      numRetries++;
      process.nextTick(attempt);
    });
  };
  attempt();
}

// This method returns the userId currently associated with an email address.
exports.getId = function(email, cb) {
  kv.store.get(email + '/uid', function(err, result) {
    if (err) return cb(internalError(err));
    if (!result) return cb(notFound('UnknownUser'));
    cb(null, result.value);
  });
};

// get meta data associated with a user
var getUserDoc = function(userId, cb) {
  kv.store.get(userId + '/user', function(err, doc) {
    if (err) return cb(internalError(err));
    if (!doc) return cb(notFound('UnknownUser'));
    doc.id = userId;
    cb(null, doc);
  });
};

// get meta data associated with a user
var getUser = exports.getUser = function(userId, cb) {
  getUserDoc(userId, function(err, doc) {
    if (err) return cb(err);
    cb(null, doc.value);
  });
};

// This account principle associated with a singing token
// The principle is the userId combined with the IDP domain
// e.g. 1234@lcip.org
//
exports.getPrinciple = function(token, cb) {
  kv.store.get(token + '/signer', function(err, result) {
    if (err) return cb(internalError(err));
    if (!result) return cb(notFound('UnknownSignToken'));

    var principle = result.value.uid + '@' + config.get('domain');

    cb(null, principle);
  });
};
