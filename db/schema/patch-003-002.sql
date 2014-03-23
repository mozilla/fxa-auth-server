ALTER TABLE `passwordChangeTokens` DROP INDEX `createdAt`;
ALTER TABLE `passwordForgotTokens` DROP INDEX `createdAt`;
ALTER TABLE `accountResetTokens` DROP INDEX `createdAt`;

DROP PROCEDURE `prune`;

DELETE FROM dbMetadata WHERE name = 'pruneLastRan';

UPDATE dbMetadata SET value = '2' WHERE name = 'schema-patch-level';
