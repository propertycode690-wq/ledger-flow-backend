import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding initial Phase 3 data...');

  // 1. Seed Delivery Vans
  const vansData = [
    { id: 'van1', name: 'Van 1', vehicle: 'Ford Transit - LN72 XRT', isActive: true },
    { id: 'van2', name: 'Van 2', vehicle: 'Mercedes Sprinter - RO23 FHK', isActive: true },
    { id: 'van3', name: 'Van 3', vehicle: 'Standard Van 3', isActive: true },
  ];

  for (const van of vansData) {
    await prisma.van.upsert({
      where: { id: van.id },
      update: {},
      create: van,
    });
  }
  console.log('✅ Vans seeded (van1, van2, van3)');

  // 2. Seed Initial Core Customers
  const customersData = [
    {
      id: 'CUST-001',
      name: 'Green Valley Restaurant',
      contactPerson: 'David Miller',
      email: 'accounts@greenvalley.co.uk',
      phone: '+44 20 7946 0912',
      address: '14 Highfield Avenue, London, NW11 9PX',
      vatNumber: 'GB 923 8812 04',
      paymentTerms: 14,
      status: 'Active',
      openingBalance: 2360.50,
      vanId: 'van1',
    },
    {
      id: 'CUST-002',
      name: 'The Fresh Kitchen',
      contactPerson: 'Elena Rostova',
      email: 'orders@freshkitchen.com',
      phone: '+44 20 7946 0831',
      address: '88 St. John Street, Clerkenwell, London, EC1M 4EH',
      vatNumber: 'GB 842 1190 22',
      paymentTerms: 30,
      status: 'Active',
      openingBalance: 0.00,
      vanId: 'van2',
    },
  ];

  for (const cust of customersData) {
    await prisma.customer.upsert({
      where: { id: cust.id },
      update: {},
      create: cust,
    });
  }
  console.log('✅ Baseline customers seeded');

  // 3. Seed Initial Wholesale Products Catalog
  const productsData = [
    { id: 'PROD-001', name: 'Vine Tomatoes', unit: 'kg', defaultRate: 3.20, defaultVat: 0, category: 'Produce', stock: 120 },
    { id: 'PROD-002', name: 'King Edward Potatoes', unit: 'kg', defaultRate: 1.45, defaultVat: 0, category: 'Produce', stock: 350 },
    { id: 'PROD-003', name: 'Spanish Brown Onions', unit: 'kg', defaultRate: 1.80, defaultVat: 0, category: 'Produce', stock: 180 },
    { id: 'PROD-004', name: 'Crisp Iceberg Lettuce', unit: 'units', defaultRate: 1.15, defaultVat: 0, category: 'Salads', stock: 95 },
    { id: 'PROD-005', name: 'English Cucumbers', unit: 'units', defaultRate: 0.95, defaultVat: 0, category: 'Salads', stock: 110 },
    { id: 'PROD-006', name: 'Mixed Bell Peppers (Red/Yellow)', unit: 'kg', defaultRate: 3.80, defaultVat: 0, category: 'Produce', stock: 65 },
    { id: 'PROD-007', name: 'Fresh Washed Carrots', unit: 'kg', defaultRate: 1.20, defaultVat: 0, category: 'Root Veg', stock: 210 },
    { id: 'PROD-008', name: 'Portobello Mushrooms', unit: 'kg', defaultRate: 4.50, defaultVat: 0, category: 'Produce', stock: 40 },
    { id: 'PROD-009', name: 'Fresh Basil Bunches', unit: 'bunches', defaultRate: 1.50, defaultVat: 0, category: 'Herbs', stock: 30 },
    { id: 'PROD-010', name: 'Avocados (Ready to Eat)', unit: 'boxes (18ct)', defaultRate: 14.50, defaultVat: 0, category: 'Produce', stock: 22 },
    { id: 'PROD-011', name: 'Extra Virgin Olive Oil 5L', unit: 'tins', defaultRate: 28.00, defaultVat: 20, category: 'Pantry', stock: 15 },
    { id: 'PROD-012', name: 'San Marzano Canned Tomatoes (2.5kg)', unit: 'cans', defaultRate: 6.50, defaultVat: 20, category: 'Pantry', stock: 48 },
  ];

  for (const prod of productsData) {
    await prisma.product.upsert({
      where: { id: prod.id },
      update: {},
      create: prod,
    });
  }
  console.log('✅ Baseline products catalog seeded (12 items)');

  // 4. Seed Initial Business Settings
  await prisma.businessSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      businessName: 'Fresh Harvest Wholesale & Logistics',
      tradingName: 'Fresh Harvest Direct Ltd',
      email: 'accounts@freshharvestdirect.co.uk',
      phone: '+44 20 8123 4567',
      address: 'Unit 4, Spitalfields Wholesale Park, London, E1 6AQ',
      vatNumber: 'GB 381 9024 11',
      companyNumber: '12948201',
      currency: 'GBP',
      currencySymbol: '£',
      invoicePrefix: 'INV-2026-',
      nextInvoiceNumber: 90,
      defaultPaymentTerms: 14,
      defaultVatRate: 20.00,
      bankName: 'Barclays Business UK',
      accountName: 'Fresh Harvest Direct Ltd',
      sortCode: '20-44-67',
      accountNumber: '83920194',
      iban: 'GB29 BARC 2044 6783 9201 94',
      squareConnected: true,
      squareMerchantId: 'sq_merch_live_89124',
      whatsAppStatus: 'disconnected',
      whatsAppPhone: '+44 7700 900123',
      notesFooter: 'Payment terms: 14 days from issue date. All produce sold remains property of Fresh Harvest Direct Ltd until paid in full.',
    },
  });
  console.log('✅ Business settings initialized');

  // 5. Seed Verified RBAC User Accounts with secure hashed passwords
  const defaultPassword = process.env.DEFAULT_SEED_PASSWORD || '123456';
  const hashedPassword = await bcrypt.hash(defaultPassword, 12);

  const usersData = [
    {
      id: 'USR-ADMIN',
      email: 'admin@freshharvest.co.uk',
      passwordHash: hashedPassword,
      role: 'admin',
      name: 'Fresh Harvest Admin',
      title: 'Business Owner / Admin',
      customerId: null,
      isActive: true,
    },
    {
      id: 'USR-ACC',
      email: 'accounts@freshharvest.co.uk',
      passwordHash: hashedPassword,
      role: 'accountant',
      name: 'Accounts & Tax Manager',
      title: 'Accountant / Auditor',
      customerId: null,
      isActive: true,
    },
    {
      id: 'USR-CUST-001',
      email: 'accounts@greenvalley.co.uk',
      passwordHash: hashedPassword,
      role: 'customer',
      name: 'David Miller',
      title: 'Customer Client',
      customerId: 'CUST-001', // Strictly bound to Green Valley Restaurant
      isActive: true,
    },
  ];

  for (const user of usersData) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash: user.passwordHash,
        customerId: user.customerId,
        role: user.role,
      },
      create: user,
    });
  }

  console.log('✅ System RBAC users seeded:');
  console.log('   - admin@freshharvest.co.uk (Role: admin)');
  console.log('   - accounts@freshharvest.co.uk (Role: accountant)');
  console.log('   - accounts@greenvalley.co.uk (Role: customer -> CUST-001)');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
