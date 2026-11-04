import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const INITIAL_TERMS_DRAFT = `## [CLIENT WORKING COMMERCIAL DRAFT — AWAITING FORMAL LEGAL SIGN-OFF]

> **IMPORTANT NOTICE TO CUSTOMER:**  
> These Wholesale Customer Terms & Conditions ("Terms") govern all wholesale fresh produce sales, credit arrangements, deliveries, and account balances provided by **B3 Fruit & Veg LTD** (trading as **B3 Invoices**, Company No: 12345678, VAT No: GB 384 9201 44).  
> *Note for Business Management: This document represents a commercial draft awaiting final legal review. Specific penalty rates, interest, and credit periods are configurable by the company administrator.*

---

### 1. Scope & Account Acceptance
1.1 By accessing the B3 Invoices Customer Portal, submitting daily orders, accepting produce deliveries, or making payments on account, the Customer agrees to be bound by these Terms.  
1.2 The individual accepting these Terms warrants and represents that they possess full legal authority to enter into binding commercial contracts on behalf of the registered business or trading entity.

### 2. Orders, Supply & Delivery
2.1 All daily wholesale produce orders are subject to availability and seasonal market fluctuations.  
2.2 B3 Fruit & Veg LTD reserves the right to make reasonable product substitutions of equal or superior commercial grade where specific produce is unavailable, subject to prior customer notification where practicable.  
2.3 Delivery shall be deemed complete upon physical transfer of goods to the customer's specified business premises or receipt by customer staff.

### 3. Inspection, Shortages & Claims
3.1 Fresh produce is perishable. The Customer must inspect all goods immediately upon delivery.  
3.2 Any discrepancies, visible damages, substandard quality, or shortages must be reported within **24 hours of delivery** via the B3 Invoices Customer Portal or directly to your assigned route driver/manager.  
3.3 Claims submitted outside this 24-hour window will not be eligible for credit notes, except where latent defects could not have been discovered by reasonable visual inspection.

### 4. Pricing, Invoicing & VAT
4.1 All prices quoted are in Pounds Sterling (£ GBP) and are exclusive of Value Added Tax (VAT), which will be charged at the prevailing HMRC rate where applicable (produce standard-rated vs zero-rated).  
4.2 Official VAT invoices are generated electronically and made available immediately in the B3 Invoices Customer Portal. Invoices will also be supplied via email or printed copy upon request.

### 5. Payment Terms & Outstanding Balance Settlement
5.1 Standard credit payment terms are strictly **14 calendar days from the invoice date**, unless alternative written credit terms have been agreed in writing by B3 Fruit & Veg LTD.  
5.2 The Customer acknowledges full liability for all outstanding invoice balances incurred under their account.  
5.3 If any invoice remains unpaid beyond the due date, B3 Fruit & Veg LTD reserves the right to:
- Temporarily suspend future produce supply and van deliveries until the overdue balance is settled;
- Revoke discretionary credit terms and require immediate payment on delivery (COD) or advance payment;
- Apply late payment interest and statutory compensation in accordance with the *Late Payment of Commercial Debts (Interest) Act 1998* (as amended and supplemented), or at an agreed commercial rate subject to legal confirmation.

### 6. Retention of Title (Ownership of Goods)
6.1 Title and legal ownership of all produce delivered shall remain with B3 Fruit & Veg LTD until the Customer has paid all outstanding invoices in full.  
6.2 Risk of loss or deterioration in the produce passes to the Customer immediately upon physical delivery.

### 7. Debt Recovery & Enforcement Costs
7.1 In the event that overdue balances require referral to third-party debt recovery agencies or legal solicitors, the Customer agrees to indemnify B3 Fruit & Veg LTD for all reasonable and documented debt collection and legal costs incurred to recover the outstanding balance.  
7.2 All disputes regarding account statements or specific invoices must be raised in writing before the payment due date. Undisputed invoice portions must be paid in accordance with standard terms.

### 8. Electronic Authorisation & Audit Records
8.1 Acceptance of these Terms is recorded electronically in the B3 Invoices audit log, capturing the accepting user's identity, timestamp (UTC), IP address, and customer entity reference.  
8.2 Electronic acceptance holds the equivalent evidentiary weight of a signed paper agreement under English commercial contract law.

### 9. Amendments & Variations
9.1 B3 Fruit & Veg LTD may update or revise these Terms from time to time to reflect operational, commercial, or regulatory changes.  
9.2 Customers will be notified upon logging into the B3 Invoices Customer Portal when a revised version requires re-acceptance.

### 10. Governing Law & Jurisdiction
10.1 These Terms and any dispute or claim arising out of or in connection with them or their subject matter shall be governed by and construed in accordance with the **laws of England and Wales**.  
10.2 The courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim.`;

export async function seedTerms() {
  console.log('--- Seeding Initial Terms & Conditions ---');

  const existing = await prisma.termsVersion.findFirst({
    where: { status: 'published' },
  });

  if (existing) {
    console.log(`Published TermsVersion already exists: [${existing.version}] "${existing.title}". Skipping seed.`);
    return existing;
  }

  const created = await prisma.termsVersion.create({
    data: {
      version: '2026-v1.0',
      title: 'B3 Invoices Customer Terms & Conditions — Wholesale Produce Supply & Credit Terms',
      content: INITIAL_TERMS_DRAFT,
      status: 'published',
      requiresReacceptance: true,
      publishedAt: new Date(),
    },
  });

  console.log(`Created initial published TermsVersion: [${created.version}] (ID: ${created.id})`);
  return created;
}

if (process.argv[1] && process.argv[1].endsWith('seedTerms.js')) {
  seedTerms()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('Seed terms error:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}

