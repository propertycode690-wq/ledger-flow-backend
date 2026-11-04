-- ==============================================================================
-- Additive Migration: Add Terms Versions & Customer Terms Acceptances Tables
-- Safe, non-destructive migration. Does not alter existing tables or columns.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS `terms_versions` (
  `id` VARCHAR(36) NOT NULL,
  `version` VARCHAR(50) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `content` LONGTEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
  `requires_reacceptance` TINYINT(1) NOT NULL DEFAULT 1,
  `published_at` DATETIME(3) NULL,
  `published_by_user_id` VARCHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `terms_versions_version_key` (`version`),
  KEY `idx_terms_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_terms_acceptances` (
  `id` VARCHAR(36) NOT NULL,
  `terms_version_id` VARCHAR(36) NOT NULL,
  `customer_id` VARCHAR(50) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `version_string` VARCHAR(50) NOT NULL,
  `accepted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `acceptance_method` VARCHAR(50) NOT NULL DEFAULT 'portal_prompt',
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_terms_version` (`user_id`, `terms_version_id`),
  KEY `idx_terms_accept_version` (`terms_version_id`),
  KEY `idx_terms_accept_customer` (`customer_id`),
  KEY `idx_terms_accept_user` (`user_id`),
  KEY `idx_terms_accept_date` (`accepted_at`),
  CONSTRAINT `customer_terms_acceptances_terms_version_id_fkey`
    FOREIGN KEY (`terms_version_id`) REFERENCES `terms_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `customer_terms_acceptances_customer_id_fkey`
    FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `customer_terms_acceptances_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

