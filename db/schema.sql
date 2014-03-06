
CREATE TABLE IF NOT EXISTS accounts (
  uid BINARY(16) PRIMARY KEY,
  normalizedEmail VARCHAR(255) NOT NULL UNIQUE KEY,
  email VARCHAR(255) NOT NULL,
  emailCode BINARY(16) NOT NULL,
  emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
  kA BINARY(32) NOT NULL,
  wrapWrapKb BINARY(32) NOT NULL,
  authSalt BINARY(32) NOT NULL,
  verifyHash BINARY(32) NOT NULL,
  verifierVersion TINYINT UNSIGNED NOT NULL,
  verifierSetAt BIGINT UNSIGNED NOT NULL,
  createdAt BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessionTokens (
  tokenId BINARY(32) PRIMARY KEY,
  tokenData BINARY(32) NOT NULL,
  uid BINARY(16) NOT NULL,
  createdAt BIGINT UNSIGNED NOT NULL,
  INDEX session_uid (uid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS keyFetchTokens (
  tokenId BINARY(32) PRIMARY KEY,
  authKey BINARY(32) NOT NULL,
  uid BINARY(16) NOT NULL,
  keyBundle BINARY(96) NOT NULL,
  createdAt BIGINT UNSIGNED NOT NULL,
  INDEX key_uid (uid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS accountResetTokens (
  tokenId BINARY(32) PRIMARY KEY,
  tokenData BINARY(32) NOT NULL,
  uid BINARY(16) NOT NULL UNIQUE KEY,
  createdAt BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS passwordForgotTokens (
  tokenId BINARY(32) PRIMARY KEY,
  tokenData BINARY(32) NOT NULL,
  uid BINARY(16) NOT NULL UNIQUE KEY,
  passCode BINARY(16) NOT NULL,
  createdAt BIGINT UNSIGNED NOT NULL,
  tries SMALLINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS passwordChangeTokens (
  tokenId BINARY(32) PRIMARY KEY,
  tokenData BINARY(32) NOT NULL,
  uid BINARY(16) NOT NULL,
  createdAt BIGINT UNSIGNED NOT NULL,
  INDEX session_uid (uid)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dbMetadata (
  name VARCHAR(255) NOT NULL PRIMARY KEY,
  value VARCHAR(255) NOT NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO dbMetadata SET name = 'pruneLastRan', value = '0';

DROP PROCEDURE IF EXISTS `prune`;

CREATE PROCEDURE `prune` (IN pruneBefore BIGINT UNSIGNED, IN now BIGINT UNSIGNED)
BEGIN
    SELECT @lastRan:=CONVERT(value, UNSIGNED) AS lastRan FROM dbMetadata WHERE `name` = 'pruneLastRan';

    IF @lastRan < pruneBefore THEN
        DELETE FROM accountResetTokens WHERE createdAt < pruneBefore;
        DELETE FROM passwordForgotTokens WHERE createdAt < pruneBefore;
        DELETE FROM passwordChangeTokens WHERE createdAt < pruneBefore;

        -- save the time this last ran at (ie. now)
        UPDATE dbMetadata SET value = CONVERT(now, CHAR) WHERE name = 'pruneLastRan';
    END IF;

END;

set @exist := ( SELECT count(*) FROM information_schema.statistics WHERE table_name = 'accountResetTokens' AND index_name = 'createdAt' );
set @sqlstmt := if( @exist > 0, 'SELECT ''INFO: Index already exists.''', 'ALTER TABLE `accountResetTokens` ADD INDEX `createdAt` (`createdAt`)');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

set @exist := ( SELECT count(*) FROM information_schema.statistics WHERE table_name = 'passwordForgotTokens' AND index_name = 'createdAt' );
set @sqlstmt := if( @exist > 0, 'SELECT ''INFO: Index already exists.''', 'ALTER TABLE `passwordForgotTokens` ADD INDEX `createdAt` (`createdAt`)');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;

set @exist := ( SELECT count(*) FROM information_schema.statistics WHERE table_name = 'passwordChangeTokens' AND index_name = 'createdAt' );
set @sqlstmt := if( @exist > 0, 'SELECT ''INFO: Index already exists.''', 'ALTER TABLE `passwordChangeTokens` ADD INDEX `createdAt` (`createdAt`)');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
