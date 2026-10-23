-- ==============================================================================
-- LedgerFlow Safe Additive Production Migration: Purchases & Suppliers Module
-- Target Engine: MySQL 8.0+ / MariaDB 10.4+
-- Safety Guarantee: 100% additive. No existing columns or tables modified/dropped.
-- ==============================================================================

-- 1. Create suppliers table (Wholesale produce suppliers)
CREATE TABLE IF NOT EXISTS `suppliers` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `contact_person` VARCHAR(255) NULL,
    `email` VARCHAR(255) NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `vat_number` VARCHAR(50) NULL,
    `payment_terms` INT NOT NULL DEFAULT 30,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 2. Create purchases table (Wholesale inventory purchase invoices/bills)
CREATE TABLE IF NOT EXISTS `purchases` (
    `id` VARCHAR(36) NOT NULL,
    `purchase_number` VARCHAR(50) NOT NULL,
    `supplier_id` VARCHAR(50) NULL,
    `supplier_name` VARCHAR(255) NOT NULL,
    `supplier_invoice_no` VARCHAR(100) NULL,
    `date` DATE NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Paid',
    `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `vat_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `total` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `purchases_purchase_number_key`(`purchase_number`),
    INDEX `idx_purchases_supplier_id`(`supplier_id`),
    INDEX `idx_purchases_date`(`date`),
    INDEX `idx_purchases_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 3. Create purchase_items table (Itemized lines on purchases with VAT & unit cost snapshots)
CREATE TABLE IF NOT EXISTS `purchase_items` (
    `id` VARCHAR(36) NOT NULL,
    `purchase_id` VARCHAR(36) NOT NULL,
    `product_id` VARCHAR(50) NULL,
    `product` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'kg',
    `unit_cost` DECIMAL(10, 2) NOT NULL,
    `vat_rate` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `vat_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `total` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_purchase_items_purchase_id`(`purchase_id`),
    INDEX `idx_purchase_items_product_id`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 4. Foreign Key Constraints (Safe additive relations)
-- Note: When executing against a fresh or existing database, run these after creating the tables above.
-- Check if constraint exists before adding if your MySQL version requires idempotency.

SET @exist_fk1 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'purchases_supplier_id_fkey');
SET @sql_fk1 := IF(@exist_fk1 = 0, 'ALTER TABLE `purchases` ADD CONSTRAINT `purchases_supplier_id_fkey` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;', 'SELECT "purchases_supplier_id_fkey already exists";');
PREPARE stmt1 FROM @sql_fk1;
EXECUTE stmt1;
DEALLOCATE PREPARE stmt1;

SET @exist_fk2 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'purchase_items_purchase_id_fkey');
SET @sql_fk2 := IF(@exist_fk2 = 0, 'ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_purchase_id_fkey` FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;', 'SELECT "purchase_items_purchase_id_fkey already exists";');
PREPARE stmt2 FROM @sql_fk2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

SET @exist_fk3 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'purchase_items_product_id_fkey');
SET @sql_fk3 := IF(@exist_fk3 = 0, 'ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;', 'SELECT "purchase_items_product_id_fkey already exists";');
PREPARE stmt3 FROM @sql_fk3;
EXECUTE stmt3;
DEALLOCATE PREPARE stmt3;
