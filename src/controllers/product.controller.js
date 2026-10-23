import { z } from 'zod';
import prisma from '../config/db.js';

export const createProductSchema = z.object({
  id: z
    .string()
    .trim()
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Product ID can only contain letters, numbers, underscores, and dashes.')
    .optional(),
  name: z.string().trim().min(1, 'Product name is required.').max(255),
  unit: z.string().trim().min(1, 'Unit of measurement is required.').max(50),
  defaultRate: z.coerce.number().min(0, 'Default rate cannot be negative.').default(0),
  defaultVat: z.coerce.number().min(0, 'Default VAT rate cannot be negative.').max(100).default(0),
  category: z.string().trim().max(100).optional().default('Produce'),
  stock: z.coerce.number().int().min(0, 'Stock quantity cannot be negative.').optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name cannot be empty.').max(255).optional(),
  unit: z.string().trim().min(1, 'Unit cannot be empty.').max(50).optional(),
  defaultRate: z.coerce.number().min(0, 'Default rate cannot be negative.').optional(),
  defaultVat: z.coerce.number().min(0, 'Default VAT rate cannot be negative.').max(100).optional(),
  category: z.string().trim().max(100).optional(),
  stock: z.coerce.number().int().min(0, 'Stock quantity cannot be negative.').optional(),
  isActive: z.boolean().optional(),
});

/**
 * Generate sequential product ID (e.g. PROD-013) if not supplied
 */
async function generateNextProductId() {
  const lastProduct = await prisma.product.findFirst({
    where: { id: { startsWith: 'PROD-' } },
    orderBy: { id: 'desc' },
  });

  if (!lastProduct) return 'PROD-001';

  const match = lastProduct.id.match(/^PROD-(\d+)$/);
  if (match) {
    const nextSeq = parseInt(match[1], 10) + 1;
    return `PROD-${String(nextSeq).padStart(3, '0')}`;
  }

  return `PROD-${Date.now().toString().slice(-4)}`;
}

/**
 * @route   GET /api/v1/products
 * @desc    List products with pagination, search, and category filters
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function listProducts(req, res) {
  try {
    const {
      search,
      category,
      includeInactive,
      page = 1,
      limit = 50,
      sortBy = 'name',
      sortOrder = 'asc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {};

    if (includeInactive !== 'true') {
      where.isActive = true;
    }

    if (category) {
      where.category = { equals: category };
    }

    if (search) {
      const trimmedSearch = search.trim();
      where.OR = [
        { name: { contains: trimmedSearch } },
        { id: { contains: trimmedSearch } },
        { category: { contains: trimmedSearch } },
      ];
    }

    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder.toLowerCase() === 'desc' ? 'desc' : 'asc' },
      }),
    ]);

    return res.status(200).json({
      status: 'ok',
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      data: products,
    });
  } catch (error) {
    console.error('List products error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve products catalog.',
    });
  }
}

/**
 * @route   GET /api/v1/products/:id
 * @desc    Get single product details
 * @access  Protected (Admin, Accountant, Customer)
 */
export async function getProductById(req, res) {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      return res.status(404).json({
        status: 'error',
        code: 'PRODUCT_NOT_FOUND',
        message: `Product with ID '${id}' was not found.`,
      });
    }

    return res.status(200).json({
      status: 'ok',
      data: product,
    });
  } catch (error) {
    console.error('Get product error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve product.',
    });
  }
}

/**
 * @route   POST /api/v1/products
 * @desc    Create a new product in the catalog
 * @access  Protected (Admin only)
 */
export async function createProduct(req, res) {
  try {
    const data = req.validatedBody;
    const productId = data.id || (await generateNextProductId());

    // Check duplicate ID
    const existing = await prisma.product.findUnique({
      where: { id: productId },
    });

    if (existing) {
      return res.status(409).json({
        status: 'error',
        code: 'DUPLICATE_PRODUCT_ID',
        message: `Product with ID '${productId}' already exists.`,
      });
    }

    const product = await prisma.product.create({
      data: {
        id: productId,
        name: data.name,
        unit: data.unit,
        defaultRate: data.defaultRate,
        defaultVat: data.defaultVat,
        category: data.category,
        stock: data.stock,
        isActive: data.isActive,
      },
    });

    return res.status(201).json({
      status: 'ok',
      message: `Product '${product.name}' created successfully.`,
      data: product,
    });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create product.',
    });
  }
}

/**
 * @route   PUT /api/v1/products/:id
 * @desc    Update product details or pricing
 * @access  Protected (Admin only)
 */
export async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const data = req.validatedBody;

    const existing = await prisma.product.findUnique({
      where: { id },
    });

    if (!existing) {
      return res.status(404).json({
        status: 'error',
        code: 'PRODUCT_NOT_FOUND',
        message: `Product with ID '${id}' was not found.`,
      });
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
    });

    return res.status(200).json({
      status: 'ok',
      message: `Product '${updated.name}' updated successfully.`,
      data: updated,
    });
  } catch (error) {
    console.error('Update product error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update product.',
    });
  }
}

/**
 * @route   DELETE /api/v1/products/:id
 * @desc    Safely deactivate or remove a product
 * @access  Protected (Admin only)
 */
export async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const { hard } = req.query;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        _count: {
          select: { invoiceItems: true },
        },
      },
    });

    if (!product) {
      return res.status(404).json({
        status: 'error',
        code: 'PRODUCT_NOT_FOUND',
        message: `Product with ID '${id}' was not found.`,
      });
    }

    // Hard delete if explicitly requested
    if (hard === 'true') {
      if (product._count.invoiceItems > 0) {
        return res.status(409).json({
          status: 'error',
          code: 'PRODUCT_HAS_INVOICE_RECORDS',
          message: `Cannot permanently delete product '${product.name}' because it is referenced in ${product._count.invoiceItems} historical invoice line item(s). Deactivate the product instead to preserve historical billing integrity.`,
        });
      }

      await prisma.product.delete({
        where: { id },
      });

      return res.status(200).json({
        status: 'ok',
        message: `Product '${product.name}' permanently deleted.`,
      });
    }

    // Safe deletion policy: Soft delete by setting isActive to false
    const deactivated = await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return res.status(200).json({
      status: 'ok',
      message: `Product '${deactivated.name}' deactivated successfully.`,
      data: deactivated,
    });
  } catch (error) {
    console.error('Delete product error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to delete product.',
    });
  }
}
