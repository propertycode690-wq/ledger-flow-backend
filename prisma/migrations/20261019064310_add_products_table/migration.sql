-- CreateTable
CREATE TABLE `products` (
    `id` VARCHAR(50) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `unit` VARCHAR(50) NOT NULL,
    `default_rate` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    `default_vat` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
    `category` VARCHAR(100) NOT NULL DEFAULT 'Produce',
    `stock` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_products_category`(`category`),
    INDEX `idx_products_is_active`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_customers_status` ON `customers`(`status`);
