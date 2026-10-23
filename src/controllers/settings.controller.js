import { z } from 'zod';
import prisma from '../config/db.js';

export const updateSettingsSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(255).optional(),
  tradingName: z.string().trim().max(255).optional().nullable(),
  email: z.string().trim().email('Valid email is required.').max(255).optional(),
  phone: z.string().trim().max(50).optional().nullable(),
  address: z.string().trim().optional().nullable(),
  vatNumber: z.string().trim().max(50).optional().nullable(),
  companyNumber: z.string().trim().max(50).optional().nullable(),
  currency: z.string().trim().max(10).optional(),
  currencySymbol: z.string().trim().max(5).optional(),
  invoicePrefix: z.string().trim().max(20).optional(),
  nextInvoiceNumber: z.number().int().min(1).optional(),
  defaultPaymentTerms: z.number().int().min(0).optional(),
  defaultVatRate: z.number().min(0).max(100).optional(),
  bankName: z.string().trim().max(100).optional().nullable(),
  accountName: z.string().trim().max(150).optional().nullable(),
  sortCode: z.string().trim().max(20).optional().nullable(),
  accountNumber: z.string().trim().max(30).optional().nullable(),
  iban: z.string().trim().max(50).optional().nullable(),
  squareConnected: z.boolean().optional(),
  squareMerchantId: z.string().trim().max(100).optional().nullable(),
  whatsAppStatus: z.string().trim().max(50).optional(),
  whatsAppPhone: z.string().trim().max(50).optional().nullable(),
  notesFooter: z.string().trim().optional().nullable(),
  notifications: z.record(z.any()).optional().nullable(),
});

/**
 * @route   GET /api/v1/settings
 * @desc    Get system-wide business preferences and company profile
 * @access  Protected (Admin, Accountant)
 */
export async function getSettings(req, res) {
  try {
    let settings = await prisma.businessSettings.findFirst({
      where: { id: 1 },
    });

    if (!settings) {
      settings = await prisma.businessSettings.create({
        data: {
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
          notesFooter:
            'Payment terms: 14 days from issue date. All produce sold remains property of Fresh Harvest Direct Ltd until paid in full.',
        },
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: {
        ...settings,
        defaultVatRate: parseFloat(settings.defaultVatRate) || 20,
      },
    });
  } catch (error) {
    console.error('Error fetching business settings:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve business settings.',
    });
  }
}

/**
 * @route   PUT /api/v1/settings
 * @desc    Update business profile and preferences in MySQL
 * @access  Protected (Admin only)
 */
export async function updateSettings(req, res) {
  try {
    const data = req.validatedBody;

    const payload = {};
    const allowedFields = [
      'businessName',
      'tradingName',
      'email',
      'phone',
      'address',
      'vatNumber',
      'companyNumber',
      'currency',
      'currencySymbol',
      'invoicePrefix',
      'nextInvoiceNumber',
      'defaultPaymentTerms',
      'defaultVatRate',
      'bankName',
      'accountName',
      'sortCode',
      'accountNumber',
      'iban',
      'squareConnected',
      'squareMerchantId',
      'whatsAppStatus',
      'whatsAppPhone',
      'notesFooter',
    ];

    allowedFields.forEach((field) => {
      if (data[field] !== undefined) {
        payload[field] = data[field];
      }
    });

    const updated = await prisma.businessSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        businessName: payload.businessName || 'Fresh Harvest Wholesale & Logistics',
        email: payload.email || 'accounts@freshharvestdirect.co.uk',
        ...payload,
      },
      update: payload,
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Business settings updated successfully.',
      data: {
        ...updated,
        defaultVatRate: parseFloat(updated.defaultVatRate) || 20,
      },
    });
  } catch (error) {
    console.error('Error updating business settings:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update business settings.',
    });
  }
}
