-- ==============================================================================
-- Additive Migration: Add Password Reset Tokens Table
-- Safe, non-destructive migration. Does not alter existing tables or columns.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `used_at` DATETIME(3) NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `password_reset_tokens_token_hash_key` (`token_hash`),
  KEY `idx_pw_reset_user_id` (`user_id`),
  KEY `idx_pw_reset_token_hash` (`token_hash`),
  KEY `idx_pw_reset_status` (`status`),
  CONSTRAINT `password_reset_tokens_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

