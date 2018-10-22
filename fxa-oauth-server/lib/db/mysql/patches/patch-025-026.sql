-- Add column to stash the `instanceId` value
ALTER TABLE codes ADD COLUMN instanceId BINARY(16) DEFAULT NULL,
ALGORITHM = INPLACE, LOCK = NONE;

ALTER TABLE tokens ADD COLUMN instanceId BINARY(16) DEFAULT NULL,
ALGORITHM = INPLACE, LOCK = NONE;

ALTER TABLE refreshTokens ADD COLUMN instanceId BINARY(16) DEFAULT NULL,
ALGORITHM = INPLACE, LOCK = NONE;

UPDATE dbMetadata SET value = '26' WHERE name = 'schema-patch-level';
