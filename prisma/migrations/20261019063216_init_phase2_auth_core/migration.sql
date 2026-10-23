-- CreateTable
CREATE TABLE `vans` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `vehicle` VARCHAR(150) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `contact_person` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `vat_number` VARCHAR(50) NULL,
    `payment_terms` INTEGER NOT NULL DEFAULT 14,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Active',
    `opening_balance` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `van_id` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_customers_van_id`(`van_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `title` VARCHAR(100) NULL,
    `customer_id` VARCHAR(50) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `idx_users_role`(`role`),
    INDEX `idx_users_customer_id`(`customer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `business_name` VARCHAR(255) NOT NULL,
    `trading_name` VARCHAR(255) NULL,
    `email` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `vat_number` VARCHAR(50) NULL,
    `company_number` VARCHAR(50) NULL,
    `currency` VARCHAR(10) NOT NULL DEFAULT 'GBP',
    `currency_symbol` VARCHAR(5) NOT NULL DEFAULT '£',
    `invoice_prefix` VARCHAR(20) NOT NULL DEFAULT 'INV-2026-',
    `next_invoice_number` INTEGER NOT NULL DEFAULT 90,
    `default_payment_terms` INTEGER NOT NULL DEFAULT 14,
    `default_vat_rate` DECIMAL(5, 2) NOT NULL DEFAULT 20.00,
    `bank_name` VARCHAR(100) NULL,
    `account_name` VARCHAR(150) NULL,
    `sort_code` VARCHAR(20) NULL,
    `account_number` VARCHAR(30) NULL,
    `iban` VARCHAR(50) NULL,
    `square_connected` BOOLEAN NOT NULL DEFAULT true,
    `square_merchant_id` VARCHAR(100) NULL,
    `whatsapp_status` VARCHAR(50) NOT NULL DEFAULT 'disconnected',
    `whatsapp_phone` VARCHAR(50) NULL,
    `notes_footer` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_van_id_fkey` FOREIGN KEY (`van_id`) REFERENCES `vans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
