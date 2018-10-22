-- ALTER TABLE tokens
-- DROP COLUMN instanceId,
-- ALGORITHM = INPLACE, LOCK = NONE;

-- ALTER TABLE codes
-- DROP COLUMN instanceId,
-- ALGORITHM = INPLACE, LOCK = NONE;

-- ALTER TABLE refreshTokens
-- DROP COLUMN instanceId,
-- ALGORITHM = INPLACE, LOCK = NONE;

-- UPDATE dbMetadata SET value = '25`' WHERE name = 'schema-patch-level';
