-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(36) NOT NULL,
    `order_number` VARCHAR(50) NOT NULL,
    `customer_id` VARCHAR(50) NOT NULL,
    `van_id` VARCHAR(50) NULL,
    `order_date` DATE NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Confirmed',
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_order_number_key`(`order_number`),
    INDEX `idx_orders_customer_id`(`customer_id`),
    INDEX `idx_orders_order_date`(`order_date`),
    INDEX `idx_orders_van_id`(`van_id`),
    INDEX `idx_orders_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` VARCHAR(36) NOT NULL,
    `order_id` VARCHAR(36) NOT NULL,
    `product_id` VARCHAR(50) NULL,
    `name` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(10, 2) NOT NULL,
    `unit` VARCHAR(50) NOT NULL DEFAULT 'kg',
    `unit_price` DECIMAL(10, 2) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_order_items_order_id`(`order_id`),
    INDEX `idx_order_items_product_id`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mileage_records` (
    `id` VARCHAR(36) NOT NULL,
    `mileage_number` VARCHAR(50) NOT NULL,
    `van_id` VARCHAR(50) NULL,
    `vehicle` VARCHAR(150) NULL,
    `date` DATE NOT NULL,
    `start_mileage` DECIMAL(10, 1) NOT NULL,
    `end_mileage` DECIMAL(10, 1) NOT NULL,
    `distance` DECIMAL(10, 1) NOT NULL,
    `distance_unit` VARCHAR(20) NOT NULL DEFAULT 'miles',
    `purpose` VARCHAR(255) NOT NULL,
    `rate` DECIMAL(6, 2) NULL,
    `estimated_expense` DECIMAL(10, 2) NULL,
    `recorded_in_expenses` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mileage_records_mileage_number_key`(`mileage_number`),
    INDEX `idx_mileage_van_id`(`van_id`),
    INDEX `idx_mileage_date`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vehicle_expenses` (
    `id` VARCHAR(36) NOT NULL,
    `expense_number` VARCHAR(50) NOT NULL,
    `van_id` VARCHAR(50) NULL,
    `vehicle` VARCHAR(150) NULL,
    `mileage_id` VARCHAR(36) NULL,
    `date` DATE NOT NULL,
    `category` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'Recorded',
    `void_reason` VARCHAR(255) NULL,
    `voided_at` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicle_expenses_expense_number_key`(`expense_number`),
    INDEX `idx_vehicle_expenses_van_id`(`van_id`),
    INDEX `idx_vehicle_expenses_date`(`date`),
    INDEX `idx_vehicle_expenses_category`(`category`),
    INDEX `idx_vehicle_expenses_mileage_id`(`mileage_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_van_id_fkey` FOREIGN KEY (`van_id`) REFERENCES `vans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mileage_records` ADD CONSTRAINT `mileage_records_van_id_fkey` FOREIGN KEY (`van_id`) REFERENCES `vans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_expenses` ADD CONSTRAINT `vehicle_expenses_van_id_fkey` FOREIGN KEY (`van_id`) REFERENCES `vans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `vehicle_expenses` ADD CONSTRAINT `vehicle_expenses_mileage_id_fkey` FOREIGN KEY (`mileage_id`) REFERENCES `mileage_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
