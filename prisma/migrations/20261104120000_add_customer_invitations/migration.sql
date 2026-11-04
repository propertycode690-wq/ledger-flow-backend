-- ==============================================================================
-- Additive Migration: Add Customer Invitations Table
-- Safe, non-destructive migration. Does not alter existing tables or columns.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `customer_invitations` (
  `id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(64) NOT NULL,
  `customer_id` VARCHAR(50) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL,
  `consumed_by_user_id` VARCHAR(36) NULL,
  `revoked_at` DATETIME(3) NULL,
  `revoked_by_user_id` VARCHAR(36) NULL,
  `created_by_user_id` VARCHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_invitations_token_hash_key` (`token_hash`),
  KEY `idx_invitations_customer_id` (`customer_id`),
  KEY `idx_invitations_status` (`status`),
  CONSTRAINT `customer_invitations_customer_id_fkey` 
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) 
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

