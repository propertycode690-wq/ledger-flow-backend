import prisma from '../config/db.js';
import { z } from 'zod';

export const createNotificationSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(255),
  description: z.string().trim().min(1, 'Description is required.'),
  type: z.enum(['info', 'success', 'warning', 'danger']).default('info'),
  link: z.string().trim().max(255).optional().nullable(),
  role: z.enum(['admin', 'accountant', 'customer']).optional().nullable(),
  userId: z.string().trim().optional().nullable(),
  customerId: z.string().trim().optional().nullable(),
});

/**
 * @route   GET /api/v1/notifications
 * @desc    Get all notifications scoped to current user session
 * @access  Authenticated
 */
export async function listNotifications(req, res) {
  try {
    const { role, id: userId, customerId } = req.user;

    const whereConditions = [];

    // Notifications assigned specifically to this user
    whereConditions.push({ userId });

    if (role === 'customer') {
      if (customerId) {
        whereConditions.push({ customerId });
      }
      whereConditions.push({ role: 'customer' });
    } else {
      // Admin and accountant receive role-scoped or global notifications
      whereConditions.push({ role });
      whereConditions.push({ role: null, userId: null, customerId: null });
    }

    const notifications = await prisma.notification.findMany({
      where: {
        OR: whereConditions,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return res.status(200).json({
      status: 'ok',
      data: notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('listNotifications error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to retrieve notifications.',
    });
  }
}

/**
 * @route   PUT /api/v1/notifications/:id/read
 * @desc    Mark a single notification as read
 * @access  Authenticated
 */
export async function markNotificationRead(req, res) {
  try {
    const { id } = req.params;

    const notif = await prisma.notification.findUnique({
      where: { id },
    });

    if (!notif) {
      return res.status(404).json({
        status: 'error',
        code: 'NOT_FOUND',
        message: 'Notification not found.',
      });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Notification marked as read.',
      data: updated,
    });
  } catch (error) {
    console.error('markNotificationRead error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to update notification.',
    });
  }
}

/**
 * @route   PUT /api/v1/notifications/read-all
 * @desc    Mark all user's notifications as read
 * @access  Authenticated
 */
export async function markAllNotificationsRead(req, res) {
  try {
    const { role, id: userId, customerId } = req.user;

    const whereConditions = [{ userId }];

    if (role === 'customer') {
      if (customerId) whereConditions.push({ customerId });
      whereConditions.push({ role: 'customer' });
    } else {
      whereConditions.push({ role });
      whereConditions.push({ role: null, userId: null, customerId: null });
    }

    await prisma.notification.updateMany({
      where: {
        OR: whereConditions,
        isRead: false,
      },
      data: { isRead: true },
    });

    return res.status(200).json({
      status: 'ok',
      message: 'All notifications marked as read.',
    });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to mark all notifications as read.',
    });
  }
}

/**
 * @route   POST /api/v1/notifications
 * @desc    Create a new persistent notification
 * @access  Admin only
 */
export async function createNotification(req, res) {
  try {
    const data = req.validatedBody;

    const notif = await prisma.notification.create({
      data: {
        title: data.title,
        description: data.description,
        type: data.type || 'info',
        link: data.link || null,
        role: data.role || null,
        userId: data.userId || null,
        customerId: data.customerId || null,
      },
    });

    return res.status(201).json({
      status: 'ok',
      message: 'Notification created successfully.',
      data: notif,
    });
  } catch (error) {
    console.error('createNotification error:', error);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create notification.',
    });
  }
}
